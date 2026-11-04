export type ImportReceipt = { created: number; existing: number; failed: number };

export function importReceiptMessage(receipt: ImportReceipt, unit: '位作者' | '个频道') {
  return `本次新增 ${receipt.created} ${unit}，已存在 ${receipt.existing} 个，失败 ${receipt.failed} 个。`;
}
