---
name: Rider API response caching
description: Why authenticated rider API responses must bypass HTTP revalidation.
---

Authenticated rider API responses must always return a complete JSON body. Disable HTTP caching and ETag-based 304 responses for these endpoints, and have the shared client request `no-store`.

**Why:** A browser or proxy can turn a successful profile or polling response into a bodyless 304. The generated client then receives no rider/order data and shows a misleading load failure even though authentication and the database are healthy.

**How to apply:** Keep API responses marked `Cache-Control: no-store`, avoid ETags on the API server, and preserve the shared client's no-store fetch behavior.