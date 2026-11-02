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

## GPS retention policy — proposed, not enabled

**Approval status:** the user chose “Prepare policy and audit only.” No GPS TTL
index, cleanup, timestamp backfill, or production release is authorized by this
document. Automatic deletion is **not enabled**. Obtain a new explicit approval
after the audit and customer-service checks below, before any maintenance.

### Proposed policy

Retain only the latest fix per order and remove it after **300 seconds (five
minutes) since its last server receipt** (`updatedAt`, a scalar BSON Date).
This matches the existing visibility window, rather than retaining an additional
GPS history. The current publisher already refreshes that Date on every accepted
fix; do not use device time, the order creation time, or `_id` time for expiry.

Use one named, single-field MongoDB TTL index with key `{ updatedAt: 1 }`,
`expireAfterSeconds: 300`, proposed name `rider_location_updated_at_expiry`.
This is a **proposal, not a startup migration**. Do not add index creation to
`connectMongo()`, deployment hooks, or either service's request handlers.
It must affect only `riderLocations`, never canonical `orders`/`users` fields.
MongoDB's TTL worker is asynchronous (normally checks roughly every minute;
load can delay removal further), not a guaranteed five-minute erasure deadline.
TTL applies to the entire document and can make existing old Date records
eligible immediately when the index is created.

Both Rider and customer readers must continue to reject missing, invalid,
future-dated, or older-than-five-minute fixes independently of deletion.
MongoDB may retain expired fixes until its next pass. A fix exactly at the
five-minute boundary is currently accepted by the Rider reader, but clients must
tolerate `null` as the TTL boundary is reached. Missing records must mean “no
current rider location,” not an application error. The next authorized genuine
device update recreates a removed record using the existing upsert.

### Read-only preflight

The standalone audit is separate from API startup, which performs unrelated
writes. From the workspace root, after independently confirming the database:

```sh
node artifacts/api-server/scripts/audit-rider-location-retention.mjs --database <confirmed-database-name>
```

It uses the configured `MONGODB_URI_RIDER` without printing the URI, compares its
selected database name with the explicit target, and reads **only**
`riderLocations`. Prefer a Mongo account restricted to read/listIndexes.
It prints aggregate counts by timestamp type and age bucket, and index metadata,
never coordinates or rider/order IDs. It does not create indexes, modify records,
or call the normal API startup path. `--help` requires no database connection.
The aggregation is a full collection scan, capped at 15 seconds with disk spill
disabled; run during low traffic. Timeout/error means an incomplete audit, not
permission to proceed. Counts and index listing are not a single atomic snapshot.
No live audit has been run as part of this policy preparation.

Before requesting maintenance approval:

1. Independently verify both services use the same cluster **and database**, not
   just similarly named collections. The explicit CLI database check alone cannot
   prove cluster identity or customer configuration.
2. Have the customer-service owner confirm there is no history/audit dependency,
   its freshness/ownership checks remain in place, and a missing record returns
   `null`. Its source and deployed configuration are outside this repository;
   this document cannot certify them.
3. Review the audit counts for expired/fresh/future BSON Dates and all non-Date
   types (including strings, numbers, arrays, null, and missing). Inspect existing
   indexes with an authorized operator; the report flags partial/sparse/hidden
   indexes but intentionally does not print partial-filter contents. Do not drop
   or replace an existing index blindly. A conflicting single-field index may
   need a separately reviewed `collMod` or replacement plan for the installed
   MongoDB version.
4. Confirm backup/recovery expectations and expected deletion volume. For a
   large backlog, arrange an approved, throttled pre-cleanup before enabling TTL
   so the initial sweep does not overload the shared cluster. Rerun the audit
   immediately before maintenance; it is not a permanent authorization.

### Existing records and eventual activation

- **Scalar BSON Dates:** old records become TTL candidates without backfill;
  fresh records expire relative to subsequent accepted updates. Investigate
  future Dates before activation; TTL otherwise retains them until that future
  time plus five minutes. Do not refresh old records to “now.”
- **Strings/numbers:** TTL will not expire these. The audit reports types, not
  inferred dates. After a separate review/approval, convert only unambiguous,
  valid timestamps using the exact existing value as a conditional update.
  Preserve the original receipt instant; never infer numeric units or timezone.
  Fresh genuine writes can replace legacy values naturally, but that alone does
  not clean up abandoned legacy records.
- **Arrays/missing/null/invalid timestamps:** do not assume they are safe under
  TTL. MongoDB TTL can use the earliest Date inside an array. Resolve arrays
  **before** activating a broad TTL index. Quarantine/export or deletion of
  invalid records needs an explicit decision with the owner, not invented time.
  Ambiguous timestamps must be counted and resolved in the approved plan; leaving
  them permanently unexpired would not meet the retention goal.
- **Batched cleanup/backfill:** a later authorized operation must be bounded,
  rate-limited, resumable, and match `_id` **and the observed `updatedAt` value**
  (or explicit absence). This prevents deleting or overwriting a concurrent fresh
  fix. Recheck expiry in the delete predicate too. Never rewrite order IDs,
  deduplicate by deleting arbitrary records, or touch orders/users as cleanup.

After approval, an operator should resolve legacy exceptions, clear a large
backlog in reviewed batches if needed, then install or reconcile the TTL index
once on the verified shared collection. Neither service needs a release to
benefit from that database index if both satisfy the current contract.
Verify index key/options, falling expired counts across TTL cycles, unchanged
fresh fixes, and both services' missing-record handling. Use only genuine,
consented rider fixes for end-to-end checks; do not seed GPS test records.
For rollback, removal of **only this approved index** stops future TTL deletion
but cannot restore deleted locations. Restoration requires an approved backup
procedure and must not present old restored coordinates as current.

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
