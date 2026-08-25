export function canonicalPaymentPath(orderId: string, desktop: boolean) {
  return desktop ? `/pos/orders/${orderId}?checkout=1` : `/pos/orders/${orderId}/payment`;
}
