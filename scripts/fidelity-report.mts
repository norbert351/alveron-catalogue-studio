/**
 * Fidelity report — the MANUAL review half of the workflow.
 *
 * The automated e2e proves the pipeline ran, stored real bytes, and enforced the
 * approval gate. It cannot prove the generated garment looks like the real one.
 * This script produces the evidence a human needs to make that call:
 *
 *   - the source photograph and the generated image, side by side
 *   - the vision model's detail-by-detail comparison (clearly labelled as a machine
 *     estimate, not a guarantee)
 *   - anything the model invented that is not in the source (so it is never
 *     passed off as real Alveron inventory)
 *
 * Output lands in ./.fidelity-report/ as PNG contact sheets plus report.json and
 * report.md. Nothing is uploaded anywhere.
 *
 *   npm run fidelity:report -- <catalogueId>
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import sharp from 'sharp';

const catalogueId = process.argv[2];
if (!catalogueId) throw new Error('Usage: npm run fidelity:report -- <catalogueId>');

const outDir = resolve('.fidelity-report', catalogueId);
await mkdir(outDir, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

/** Fetch a private object through the app's own storage layer (keeps key validation). */
async function fetchObject(objectKey: string, storageProvider: string | null): Promise<Buffer> {
  const { getPrivateStorage } = await import('../src/lib/storage');
  return getPrivateStorage((storageProvider ?? 'local') as 'local' | 's3').get(objectKey);
}

function xml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

try {
  const catalogue = (await pool.query('SELECT title, style, occasion, status FROM catalogues WHERE id=$1', [catalogueId])).rows[0];
  if (!catalogue) throw new Error(`Catalogue ${catalogueId} not found.`);

  const sources = (await pool.query(
    `SELECT p.name, p.category, p.color, ci.outfit_role, i.object_key, i.storage_provider, i.sha256, i.vision_attributes, i.vision_model, i.vision_error
       FROM catalogue_items ci JOIN products p ON p.id=ci.product_id JOIN product_images i ON i.id=ci.product_image_id
      WHERE ci.catalogue_id=$1 ORDER BY ci.position`, [catalogueId])).rows;

  const assets = (await pool.query(
    `SELECT id, object_key, storage_provider, sha256, width, height, media_type, provider, provider_model, provider_request_id,
            fidelity, fidelity_ratio, fidelity_method, output_kind, created_at
       FROM generated_assets WHERE catalogue_id=$1 ORDER BY created_at DESC`, [catalogueId])).rows;

  if (!assets.length) {
    console.log('No generated assets for this catalogue — nothing to review.');
  }

  const report = {
    catalogueId,
    title: catalogue.title,
    generatedAt: new Date().toISOString(),
    provider: assets[0]?.provider ?? null,
    providerModel: assets[0]?.provider_model ?? null,
    sources: sources.map((source) => ({
      name: source.name, category: source.category, colour: source.color, role: source.outfit_role,
      sha256: source.sha256, visionModel: source.vision_model,
      visionVerified: Boolean(source.vision_attributes?.verified),
      visibleDetails: source.vision_attributes?.details ?? [],
      visionError: source.vision_error,
    })),
    outputs: [] as unknown[],
    manualReviewChecklist: [
      'Colour matches the source photograph (not merely "similar burgundy").',
      'Print/pattern scale and placement match, including any alignment at seams.',
      'Construction details that define the garment are present (lapels, pockets, buttons, seams, closures).',
      'Garment cut and proportion look like the real item, not a generic blazer.',
      'No accessory, garment, logo or label appears that is not in the source photographs.',
      'Nothing in the image implies the studio stocks an item it does not.',
    ],
    automatedChecksProve: [
      'The provider received the real uploaded bytes.',
      'The output was persisted privately and its checksum matches its bytes.',
      'The asset records its provider, model and request id.',
      'Approval is required and is bound to the exact output checksum before export.',
    ],
    automatedChecksDoNotProve: [
      'That the generated garment is a faithful representation of the real one.',
      'That the colour is accurate to the physical fabric under real light.',
      'That the print scale matches the physical garment.',
    ],
  };

  for (const [index, asset] of assets.entries()) {
    const bytes = await fetchObject(asset.object_key, asset.storage_provider);
    const imagePath = resolve(outDir, `output-${index + 1}-${asset.id.slice(0, 8)}.png`);
    await sharp(bytes).png().toFile(imagePath);

    // Contact sheet: source photograph beside the generated output.
    const primary = sources[0];
    if (primary) {
      const sourceBytes = await fetchObject(primary.object_key, primary.storage_provider);
      const cell = 620;
      const sourcePanel = await sharp(sourceBytes).resize(cell, cell, { fit: 'contain', background: '#efe9df' }).png().toBuffer();
      const outputPanel = await sharp(bytes).resize(cell, cell, { fit: 'contain', background: '#efe9df' }).png().toBuffer();
      const label = (text: string, left: number) => Buffer.from(
        `<svg width="${cell}" height="46" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#171717"/><text x="${left}" y="30" font-family="Arial" font-size="17" fill="#efe9df">${xml(text)}</text></svg>`,
      );
      const sheet = await sharp({ create: { width: cell * 2 + 24, height: cell + 46 + 24, channels: 3, background: '#efe9df' } })
        .composite([
          { input: label('SOURCE PHOTOGRAPH (real upload)', 16), top: 0, left: 0 },
          { input: label('GENERATED OUTPUT (AI)', 16), top: 0, left: cell + 24 },
          { input: sourcePanel, top: 46 + 12, left: 0 },
          { input: outputPanel, top: 46 + 12, left: cell + 24 },
        ]).png().toBuffer();
      await writeFile(resolve(outDir, `compare-${index + 1}-${asset.id.slice(0, 8)}.png`), sheet);
    }

    const fidelity = asset.fidelity ?? null;
    report.outputs.push({
      assetId: asset.id,
      kind: asset.output_kind,
      provider: asset.provider,
      model: asset.provider_model,
      providerRequestId: asset.provider_request_id,
      dimensions: `${asset.width}x${asset.height}`,
      sha256: asset.sha256,
      fidelityRatio: asset.fidelity_ratio === null ? null : Number(asset.fidelity_ratio),
      fidelityMethod: asset.fidelity_method,
      fidelityVerdict: asset.fidelity_ratio === null
        ? 'NOT MEASURED — manual review required'
        : `${Math.round(Number(asset.fidelity_ratio) * 100)}% of checked details measured as preserved (machine estimate)`,
      detailChecks: fidelity?.checks ?? [],
      inventedItems: fidelity?.invented ?? [],
      machineNote: fidelity?.note ?? null,
      imagePath,
    });
  }

  await writeFile(resolve(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    `# Fidelity report — ${catalogue.title}`,
    '',
    `Catalogue: \`${catalogueId}\`  `,
    `Provider: ${report.provider ?? 'none'} (${report.providerModel ?? 'n/a'})  `,
    `Generated: ${report.generatedAt}`,
    '',
    '## What automated checks prove',
    ...report.automatedChecksProve.map((line) => `- ${line}`),
    '',
    '## What automated checks do NOT prove',
    ...report.automatedChecksDoNotProve.map((line) => `- ${line}`),
    '',
    '## Manual review checklist',
    ...report.manualReviewChecklist.map((line) => `- [ ] ${line}`),
    '',
    '## Outputs',
  ];
  for (const output of report.outputs as Array<Record<string, unknown>>) {
    lines.push(
      '',
      `### ${String(output.assetId).slice(0, 8)} (${output.kind})`,
      `- Verdict: **${output.fidelityVerdict}**`,
      `- Dimensions: ${output.dimensions}`,
      `- sha256: \`${String(output.sha256).slice(0, 16)}…\``,
      `- Provider request: \`${output.providerRequestId ?? 'n/a'}\``,
    );
    const checks = output.detailChecks as Array<{ detail: string; preserved: boolean | null; note: string | null }>;
    if (checks.length) {
      lines.push('', '| Detail | Preserved (machine) | Note |', '|---|---|---|');
      for (const check of checks) {
        lines.push(`| ${check.detail} | ${check.preserved === true ? 'yes' : check.preserved === false ? 'no' : 'not measured'} | ${check.note ?? ''} |`);
      }
    }
    const invented = output.inventedItems as string[];
    if (invented.length) {
      lines.push('', `**Invented elements (NOT Alveron inventory):** ${invented.join(', ')}`);
    }
  }
  await writeFile(resolve(outDir, 'report.md'), `${lines.join('\n')}\n`);

  console.log(`Report written to ${outDir}`);
  console.log(`Compare sheets: ${assets.length} `);
  console.log('Open report.md and the compare-*.png sheets, then check each item on the manual checklist.');
} finally {
  await pool.end().catch(() => undefined);
}
