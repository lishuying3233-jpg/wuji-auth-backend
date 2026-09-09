function decideActivationState(result, hasStoredCode) {
  if (result?.valid === true) {
    return { allow: true, action: 'keep', reason: '' };
  }

  if (result?.permanent === true) {
    return {
      allow: false,
      action: 'invalidate',
      reason: result.reason || '云端授权已失效',
    };
  }

  if (result?.transient === true) {
    return {
      allow: Boolean(hasStoredCode),
      action: hasStoredCode ? 'keep' : 'invalidate',
      reason: result.reason || '云端暂时无法连接',
    };
  }

  return {
    allow: false,
    action: 'invalidate',
    reason: '授权状态无法确认',
  };
}

module.exports = { decideActivationState };
