CREATE INDEX idx_print_jobs_store_status_target_created
  ON print_jobs(store_id, status, target_device_id, created_at, id);

CREATE INDEX idx_print_jobs_store_printing_watchdog
  ON print_jobs(store_id, status, claimed_by_device_id, printing_at);
