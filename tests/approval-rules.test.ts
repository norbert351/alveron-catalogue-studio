import test from 'node:test';
import assert from 'node:assert/strict';
import { isApprovalCurrent } from '../src/lib/approval-rules';

const approved = { catalogueStatus: 'approved', catalogueRevision: 4, approvedRevision: 4, approvalChecksum: 'a'.repeat(64), outputChecksum: 'a'.repeat(64), invalidatedAt: null };

test('an approval is current only for the exact unchanged output checksum and revision', () => {
  assert.equal(isApprovalCurrent(approved), true);
  assert.equal(isApprovalCurrent({ ...approved, outputChecksum: 'b'.repeat(64) }), false);
  assert.equal(isApprovalCurrent({ ...approved, catalogueRevision: 5 }), false);
  assert.equal(isApprovalCurrent({ ...approved, invalidatedAt: new Date() }), false);
  assert.equal(isApprovalCurrent({ ...approved, catalogueStatus: 'review' }), false);
});
