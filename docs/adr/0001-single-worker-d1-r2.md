# ADR-0001: Single Worker + D1 + R2

Status: Accepted

React SPA/PWA và `/api` deploy cùng Cloudflare Worker. D1 là relational source of truth; R2 là
private media store. V1 không dùng Pages riêng, Durable Objects, offline replica hoặc branch_id.

Lý do: một deploy unit, same-origin cookie/CSRF boundary, ít hạ tầng và phù hợp pilot.
