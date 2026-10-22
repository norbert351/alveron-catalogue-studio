import 'server-only';
import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { getPool } from '../db';
import { configuredStorageProvider, getPrivateStorage } from '../storage';
import { clearRecoveryObject, discardRecoveryObject, reserveRecoveryObject } from '../storage-recovery';
import { claimNextJob, completeJob, failJob, recoverExpiredJobs, type ClaimedJob } from './queue';
import { getImageGenerationProvider, providerAvailability } from './provider';
import { ProviderError } from './providers/fal-kontext';
import { extractGarmentAttributes, reviewFidelity, type GarmentAttributes } from './vision';
import { env } from '../config';

/**
 * Generation worker.
 *
 * One tick = recover dead leases, then drain runnable jobs. The worker is
 * callable from a route (so the studio can run inline after queueing) and from
 * `scripts/generation-worker.mts` (so it can run as a long-lived process). Both
 * paths share this file, so there is exactly one implementation of the pipeline.
 *
 * Pipeline per job:
 *   claim -> load real product bytes -> (vision) extract attributes -> generate
 *        -> persist output under the catalogue's own key space -> measure fidelity
 *        -> insert generated_assets row -> complete job
 *
 * Every persisted object is reserved in storage_recovery_objects first, so a crash
 * mid-write leaves an accounted-for file instead of an invisible orphan.
 */

export const MAX_JOBS_PER_TICK = 3;

type JobSettings = { style?: string; occasion?: string; retryOf?: string };

export type TickResult = {
  recovered: { requeued: number; failed: number };
  processed: Array<{ jobId: string; catalogueId: string; outcome: 'complete' | 'retry' | 'failed'; assetId?: string; errorCode?: string; errorMessage?: string }>;
};

function sha256(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }

async function loadSourceImages(catalogueId: string) {
  const result = await getPool().query<{
    product_id: string; product_name: string; category: string; colour: string | null; pattern: string | null; fabric: string | null;
    outfit_role: string; image_id: string; object_key: string; storage_provider: string | null; media_type: string; sha256: string;
    vision_attributes: GarmentAttributes | null;
  }>(`SELECT p.id AS product_id, p.name AS product_name, p.category, p.color, p.pattern, p.fabric,
             ci.outfit_role, i.id AS image_id, i.object_key, i.storage_provider, i.media_type, i.sha256, i.vision_attributes
        FROM catalogue_items ci
        JOIN products p ON p.id = ci.product_id
        JOIN product_images i ON i.id = ci.product_image_id
       WHERE ci.catalogue_id = $1
       ORDER BY ci.position`, [catalogueId]);
  return result.rows;
}

/**
 * Read the source bytes for every item, and make sure the vision attributes exist.
 * Attributes are cached on the image row the first time they are read, so a
 * regeneration reuses the same reading of the same immutable original.
 */
async function resolveSources(catalogueId: string) {
  const rows = await loadSourceImages(catalogueId);
  const storage = getPrivateStorage(configuredStorageProvider());
  const sources: Array<{
    productId: string; imageId: string; name: string; role: string; bytes: Buffer;
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; sha256: string; attributes: GarmentAttributes | null;
  }> = [];
  for (const row of rows) {
    const bytes = await storage.get(row.object_key);
    const actual = sha256(bytes);
    if (actual !== row.sha256) {
      // The original no longer matches its recorded checksum. Refuse to generate
      // from it: generating from an unexplained file would make the output
      // untraceable to the product the owner approved.
      throw new ProviderError('source_integrity_failed', `Original for "${row.product_name}" does not match its recorded checksum; refusing to generate from it.`, false);
    }
    let attributes = row.vision_attributes;
    if (!attributes) {
      const extracted = await extractGarmentAttributes({ bytes, mediaType: row.media_type as 'image/png' });
      attributes = extracted;
      if (extracted.verified) {
        await getPool().query(
          `UPDATE product_images SET vision_attributes=$2, vision_extracted_at=now(), vision_model=$3, vision_error=NULL WHERE id=$1`,
          [row.image_id, JSON.stringify(extracted), extracted.model],
        ).catch(() => undefined);
      } else {
        await getPool().query(
          `UPDATE product_images SET vision_error=$2 WHERE id=$1`,
          [row.image_id, extracted.error],
        ).catch(() => undefined);
      }
    }
    sources.push({
      productId: row.product_id, imageId: row.image_id, name: row.product_name, role: row.outfit_role,
      bytes, mediaType: row.media_type as 'image/png', sha256: actual, attributes,
    });
  }
  return sources;
}

/** Build the detail list the generation prompt must preserve, from measured facts only. */
function preservedDetails(sources: Awaited<ReturnType<typeof resolveSources>>): string[] {
  const details: string[] = [];
  for (const source of sources) {
    const attributes = source.attributes;
    if (!attributes?.verified) continue;
    if (attributes.colour) details.push(`${source.name}: colour ${attributes.colour}`);
    if (attributes.pattern) details.push(`${source.name}: pattern ${attributes.pattern}`);
    details.push(...attributes.details.map((detail) => `${source.name}: ${detail}`));
  }
  return details.slice(0, 14);
}

async function ownsLease(jobId: string): Promise<boolean> {
  const result = await getPool().query("SELECT 1 FROM generation_jobs WHERE id=$1 AND status='running'", [jobId]);
  return (result.rowCount ?? 0) > 0;
}

/** Kept for callers that need to know if this worker still holds the job. */
export { ownsLease };

async function processJob(job: ClaimedJob): Promise<TickResult['processed'][number]> {
  const pool = getPool();
  const settings = (job.settings ?? {}) as JobSettings;
  const provider = getImageGenerationProvider();
  if (!provider) {
    const availability = providerAvailability();
    await failJob(job.id, 'provider_not_configured', availability.reason ?? 'No image-generation provider is configured.', 0);
    await pool.query("UPDATE catalogues SET status='draft', updated_at=now() WHERE id=$1 AND status='queued'", [job.catalogue_id]);
    return { jobId: job.id, catalogueId: job.catalogue_id, outcome: 'failed', errorCode: 'provider_not_configured', errorMessage: availability.reason ?? undefined };
  }

  await pool.query("UPDATE catalogues SET status='running', updated_at=now() WHERE id=$1", [job.catalogue_id]);

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), (Number(env.IMAGE_GENERATION_TIMEOUT_SECONDS || '180') + 60) * 1000);

  try {
    const sources = await resolveSources(job.catalogue_id);
    if (sources.length === 0) {
      await failJob(job.id, 'no_sources', 'This catalogue has no source products.', 0);
      await pool.query("UPDATE catalogues SET status='draft', updated_at=now() WHERE id=$1", [job.catalogue_id]);
      return { jobId: job.id, catalogueId: job.catalogue_id, outcome: 'failed', errorCode: 'no_sources' };
    }

    const details = preservedDetails(sources);
    const catalogue = await pool.query<{ title: string; style: string; occasion: string; revision: number }>(
      'SELECT title, style, occasion, revision FROM catalogues WHERE id=$1', [job.catalogue_id]);
    const row = catalogue.rows[0];
    // The approval gate compares an asset's input_snapshot against the catalogue's
    // current revision and the live inventory revision. Record both here, in the same
    // shape the original-photo composer uses, or approval always reports "stale".
    const inventoryRevision = Number((await pool.query('SELECT revision FROM studio_inventory_state WHERE id=1')).rows[0]?.revision ?? 0);

    const generated = await provider.generate({
      prompt: '',
      sourceImages: sources.map((source) => ({ productId: source.productId, imageId: source.imageId, bytes: source.bytes, mediaType: source.mediaType, sha256: source.sha256 })),
      preservedDetails: details,
      style: settings.style ?? row?.style ?? 'editorial',
      occasion: settings.occasion ?? row?.occasion ?? 'day',
      width: 1080,
      height: 1350,
      signal: abort.signal,
    });

    // Persist under the catalogue's own key space; product_images are never reused.
    const storage = getPrivateStorage(configuredStorageProvider());
    const extension = generated.mediaType === 'image/jpeg' ? 'jpg' : generated.mediaType === 'image/webp' ? 'webp' : 'png';
    const objectKey = `catalogues/${job.catalogue_id}/outputs/${randomUUID()}.${extension}`;
    const digest = sha256(generated.bytes);
    const recoveryId = await reserveRecoveryObject(pool, {
      objectKey, provider: configuredStorageProvider(), purpose: 'catalogue-output',
      entityId: job.catalogue_id, sha256: digest, byteSize: generated.bytes.byteLength,
    });

    try {
      await storage.put(objectKey, generated.bytes, generated.mediaType);
    } catch (error) {
      await discardRecoveryObject(pool, storage, recoveryId, objectKey);
      throw new ProviderError('storage_write_failed', `The generated image could not be stored: ${(error as Error).message}`, true);
    }

    // Measure fidelity before committing, so the asset row already carries it.
    const primary = sources[0];
    const fidelity = await reviewFidelity({
      sourceBytes: primary.bytes,
      sourceMediaType: primary.mediaType,
      generatedBytes: generated.bytes,
      generatedMediaType: generated.mediaType,
      expectedDetails: primary.attributes?.details?.length ? primary.attributes.details : details.slice(0, 8),
    }).catch(() => null);

    const asset = await pool.query<{ id: string }>(
      `INSERT INTO generated_assets
         (catalogue_id, object_key, sha256, width, height, media_type, byte_size, output_kind,
          input_snapshot, storage_provider, generation_job_id, provider, provider_model, provider_request_id,
          fidelity, fidelity_ratio, fidelity_method, source_sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'generated',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        job.catalogue_id, objectKey, digest, generated.width, generated.height, generated.mediaType, generated.bytes.byteLength,
        JSON.stringify({
          catalogueId: job.catalogue_id,
          revision: Number(row?.revision ?? 0),
          inventoryRevision,
          provider: provider.id,
          model: provider.model,
          preservedDetails: details,
          items: sources.map((source) => ({ productId: source.productId, imageId: source.imageId, sha256: source.sha256, role: source.role })),
          sources: sources.map((source) => ({ productId: source.productId, imageId: source.imageId, sha256: source.sha256 })),
        }),
        configuredStorageProvider(), job.id, provider.id, provider.model, generated.providerRequestId ?? null,
        fidelity ? JSON.stringify(fidelity) : null, fidelity?.ratio ?? null, fidelity?.method ?? null, primary.sha256,
      ],
    );
    const assetId = asset.rows[0].id;

    for (const item of fidelity?.invented ?? []) {
      await pool.query('INSERT INTO generation_invented_items (generated_asset_id, label) VALUES ($1,$2)', [assetId, item]).catch(() => undefined);
    }

    await clearRecoveryObject(pool, recoveryId);
    await pool.query('UPDATE generation_jobs SET completed_asset_id=$2, provider_request_id=COALESCE($3, provider_request_id), updated_at=now() WHERE id=$1',
      [job.id, assetId, generated.providerRequestId ?? null]);
    await completeJob(job.id);
    await pool.query("UPDATE catalogues SET status='review', updated_at=now(), rejection_reason=NULL WHERE id=$1", [job.catalogue_id]);
    await pool.query(
      `INSERT INTO audit_events(actor_id, action, entity_type, entity_id, detail) VALUES (NULL,'generation.complete','catalogue',$1,$2)`,
      [job.catalogue_id, JSON.stringify({ jobId: job.id, assetId, provider: provider.id, model: provider.model, fidelityRatio: fidelity?.ratio ?? null, fidelityMethod: fidelity?.method ?? null })],
    );
    return { jobId: job.id, catalogueId: job.catalogue_id, outcome: 'complete', assetId };
  } catch (error) {
    const providerError = error instanceof ProviderError ? error : null;
    const code = providerError?.code ?? (error as Error).name === 'AbortError' ? 'generation_timeout' : 'generation_unexpected';
    const message = (error as Error).message || 'Generation failed.';
    const retryable = providerError ? providerError.retryable : true;
    const { retried } = retryable
      ? await failJob(job.id, code, message, 20)
      : await failJob(job.id, code, message, 0);
    if (!retried) {
      // Only take the catalogue out of a live state; never clobber a newer run.
      await pool.query("UPDATE catalogues SET status='failed', updated_at=now() WHERE id=$1 AND status IN ('queued','running')", [job.catalogue_id]);
    } else {
      await pool.query("UPDATE catalogues SET status='queued', updated_at=now() WHERE id=$1 AND status='running'", [job.catalogue_id]);
    }
    await pool.query(
      `INSERT INTO audit_events(actor_id, action, entity_type, entity_id, detail) VALUES (NULL,$2,'catalogue',$1,$3)`,
      [job.catalogue_id, retried ? 'generation.retry_scheduled' : 'generation.failed', JSON.stringify({ jobId: job.id, code, message: message.slice(0, 300) })],
    ).catch(() => undefined);
    return { jobId: job.id, catalogueId: job.catalogue_id, outcome: retried ? 'retry' : 'failed', errorCode: code, errorMessage: message.slice(0, 300) };
  } finally {
    clearTimeout(timeout);
  }
}

/** Run one worker tick. Safe to call concurrently; claims are serialised in the DB. */
export async function runGenerationTick(workerId = `worker-${process.pid}`): Promise<TickResult> {
  const recovered = await recoverExpiredJobs();
  const processed: TickResult['processed'] = [];
  for (let index = 0; index < MAX_JOBS_PER_TICK; index += 1) {
    const job = await claimNextJob(workerId);
    if (!job) break;
    processed.push(await processJob(job));
  }
  if (recovered.requeued > 0 || recovered.failed > 0) {
    await getPool().query(
      `INSERT INTO audit_events(actor_id, action, entity_type, entity_id, detail) VALUES (NULL,'generation.recovery','system',NULL,$1)`,
      [JSON.stringify({ ...recovered, workerId })],
    ).catch(() => undefined);
  }
  return { recovered, processed };
}
