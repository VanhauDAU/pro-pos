export function getPosCustomerAccess(
  permissions: readonly string[] | null | undefined,
  isOwner: boolean,
) {
  const granted = new Set(permissions ?? []);
  return {
    canAttachCustomer: isOwner || granted.has('order.add_customer'),
    canCreateCustomer: isOwner || granted.has('customer.list.create'),
  };
}
