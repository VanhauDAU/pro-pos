-- Optimization indexes for cleaning up accepted/handled guest orders and service requests of completed orders
CREATE INDEX IF NOT EXISTS idx_guest_orders_order_status ON guest_order_requests(order_id, status);
CREATE INDEX IF NOT EXISTS idx_service_requests_order_status ON service_requests(order_id, status);
