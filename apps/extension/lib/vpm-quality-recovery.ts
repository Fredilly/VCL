export type VpmRecoveryCommerce = {
  verified_mapping?: {
    hit?: boolean;
    reuse?: string;
    reason?: string;
    candidates_compared?: number;
  };
};

export function shouldAttemptVpmNearbyRecovery(commerce: VpmRecoveryCommerce): boolean {
  const vm = commerce.verified_mapping;
  return Boolean(
    vm
    && vm.hit === false
    && vm.reuse === 'same_video'
    && vm.reason === 'visual_rejected'
    && vm.candidates_compared === 1
  );
}
