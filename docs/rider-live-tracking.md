# Rider → customer live tracking

## Contract

Rider web, native foreground and native background GPS callbacks publish actual
device coordinates to the Rider API's authenticated `POST /api/rider/location`.
The payload's `orderId` must be the MongoDB `orders._id` hex string, not the
restaurant order number or a legacy `id`.

The Rider API verifies its session or bearer token and checks that the order has
that `riderId` and status `"Rider Picked Up"`. It upserts into `riderLocations`:

- `orderId`: canonical MongoDB order `_id` hex string
- `riderId`: verified rider identity
- `lat`, `lng`: device coordinates
- `updatedAt`: server receipt time, MongoDB Date

The supplied customer handler reads that same collection using `orderId` and
returns `{lat, lng, ts}` or `null` after five minutes without a valid update.
It retains its own trusted customer session/bearer verification and
customer/assigned-rider/admin ownership checks.

**Both production services must connect to the same MongoDB database.** No
customer-token forwarding or unauthenticated cross-backend POST is required.
Absence of POSTs in customer-server logs is expected with this shared-storage
design: the POST terminates at the Rider API. If these services use different
databases, this is not a working bridge; configure shared storage or provide an
authenticated receiving API before claiming live tracking works.

The Rider API's own GET is now restricted to the authenticated assigned rider.
Customers should use the customer backend's ownership-checked GET, not that
Rider-only endpoint.

## Changes needed in production

No deployment is performed by this change. The Rider API storage fix must be
released, the customer's locally fixed MongoDB-ID lookup must be released
separately, and the client publisher improvements must reach rider devices.
No migration, database query, GPS write, push notification, or release is needed
to run the coordinate-free unit checks.

## Genuine-device verification (not performed by automated tests)

Do not insert fabricated coordinates, replay an old position, use customer GPS,
or copy tokens into logs.

1. Use a real rider's consented device and an actual order assigned to that
   rider. Record its MongoDB `_id` privately; do not substitute the displayed
   restaurant order number.
2. Before pickup, confirm publishing is rejected. After `"Rider Picked Up"`,
   allow the existing location disclosure/permissions and wait for a genuine
   fresh GPS fix. Sharing should appear only after an acknowledged POST.
3. Confirm `POST /api/rider/location` succeeds at the Rider API without logging
   payloads. As the actual order-owning customer, read
   `/api/orders/{mongoOrderId}/rider-location` on the customer backend using its
   normal verified login. Confirm `ts` advances as the device publishes, and
   the map shows the rider rather than the customer's device.
4. Repeat with the rider app backgrounded with background permission granted.
   Check stationary updates as well as movement. Background tasks can still be
   restricted by OS battery rules, force-stop, or missing permissions.
5. Verify signed-out/other riders cannot publish or read this order. Verify
   customer accounts unrelated to the order cannot read it on the customer API.
6. Complete the delivery: subsequent rider POSTs must fail. After the freshness
   window with no accepted update, the customer reader must return `null`.

The local checks cover ID normalization, auth/assignment filters, invalid-input
rejection, no-cache reads and freshness handling. They intentionally contain no
valid coordinate fixtures and do not claim successful real-device end-to-end
verification.
