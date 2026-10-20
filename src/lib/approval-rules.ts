export type ApprovalState = {
  catalogueStatus: string;
  catalogueRevision: number;
  approvedRevision: number;
  approvalChecksum: string | null;
  outputChecksum: string;
  invalidatedAt: Date | string | null;
};

export function isApprovalCurrent(state: ApprovalState): boolean {
  return ['approved', 'exported'].includes(state.catalogueStatus)
    && state.catalogueRevision === state.approvedRevision
    && Boolean(state.approvalChecksum)
    && state.approvalChecksum === state.outputChecksum
    && state.invalidatedAt === null;
}
