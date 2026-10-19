# AyojanPro — Project Requirements

## 1. Project Overview

**AyojanPro** is a local event management and event-service booking platform. It connects **clients who organize events** with **professionals who provide event-related services**, performed on-site in person (photography, videography, drone coverage, decoration, makeup, sound, etc.). It is specifically an event-service platform, not a generic freelancing marketplace.

### Core Workflow

```text
Client Registration/Login
        ↓
Create Event
        ↓
Add Service Requirements
        ↓
Professionals Discover Events
        ↓
Professional Submits Proposal
        ↓
Client Accepts Proposal
        ↓
Contract Created
        ↓
30% Upfront Payment
        ↓
Service Executed On-Site
        ↓
Professional Submits Deliverable(s) & Marks Delivered
        ↓
70% Final Payment
        ↓
Contract Completed
        ↓
Mutual Reviews
        ↓
Possible Dispute Resolution
```

## 2. User Roles

Exactly three roles exist:

- `CLIENT`
- `PROFESSIONAL`
- `ADMIN`

### Client

Clients can register/login with credentials or Google OAuth, manage their profile, create and publish events, define multiple service requirements, set a separate budget and event time for each service, receive and review proposals, accept proposals, hire the same professional for multiple requirements of one event, hire different professionals for different requirements, make bKash payments, confirm/complete services, review professionals, and raise disputes with evidence.

### Professional

A professional does **not** go through a separate application entity. Applying to become a professional **is** creating the `Professional` profile itself: a `User` account with role `PROFESSIONAL` is created together with a `Professional` record that starts in `PENDING` status and carries the application information directly (personal/professional details, services, skills, experience, portfolio, resume, additional supporting files). There is no separate `ProfessionalApplication` table — the profile the applicant fills out **is** the professional's eventual profile.

Admin reviews the same `Professional` record and flips its status to `APPROVED` or `REJECTED` (with an optional `rejectionReason`). Only an `APPROVED` professional is treated as active on the platform — a `PENDING` or `REJECTED` professional cannot browse events or submit proposals, even though the row already exists.

Active (`APPROVED`) professionals can manage their profile, multiple services, skills, experience, portfolio; enable/disable `acceptingBookings`; browse events; submit proposals for suitable service requirements; provide contracted services in person; submit deliverables; receive payments; review clients; and raise disputes.

A professional may provide multiple services and may be hired for multiple service requirements of the same event. `acceptingBookings = false` prevents new bookings but does not invalidate existing confirmed contracts.

### Admin

Admin manages clients, professionals (including reviewing pending applications on the `Professional` record itself), events, service requirements, proposals, contracts, payments, disputes, evidence and platform-level operations. Admin can approve/reject professionals and resolve disputes.

## 3. Authentication and Authorization

Only clients use the normal public registration flow. Client authentication supports:

1. Credential authentication with email verification.
2. Google OAuth.

Professionals follow:

```text
User account (role=PROFESSIONAL) + Professional profile (status=PENDING)
        ↓
Admin reviews the Professional record
        ↓
status = APPROVED → professional becomes active
status = REJECTED → professional stays inactive, rejectionReason recorded
```

Admin accounts are controlled by the platform and may be seeded/created administratively.

Every protected operation must verify authentication, identity, role and resource ownership/permission. A `PENDING` or `REJECTED` professional must be blocked from any professional-only action even though the account exists.

## 4. Profiles

Identity fields (`name`, `email`, `profile image`) live on `User` for **both** clients and professionals — neither role duplicates them. Role-specific models only hold role-specific data.

### Client Profile

`Client` holds phone, profile image, bio, address, city, country.

### Professional Profile

`Professional` holds phone, address, city, country, professional title, bio, years of experience, `acceptingBookings`, application/review metadata (`status`, `reviewedById`, `reviewedAt`, `rejectionReason`, `resume`, `additionalFiles`), and aggregate rating info (`averageRating`, `totalReviews`).

## 5. Professional Services, Skills and Experience

A professional can provide **multiple services**, such as photography, videography, drone coverage, decoration, makeup or sound management.

A professional service may contain service name/category, description, pricing information (min/max), an active flag, and metadata.

Professionals can maintain skills (from a shared `Skill` catalog, joined via `ProfessionalSkill`) and experience entries (position/title, description, organization, start date, end date).

## 6. Professional Portfolio

Professionals can maintain multiple portfolio items showcasing previous/major events: title, description, event/work type, media URL, external URL, work date. Cloudinary may be used for media storage.

## 7. Event Management

Clients can create and publish events containing:

- Title
- Description
- Event type/category
- Location (address, city, country)
- Overall `startAt`
- Overall `endAt`
- Status
- Other event details

The overall event time describes the event, while each service requirement has its own actual service time.

## 8. Event Service Requirements

An event can contain multiple independent service requirements:

```text
Wedding
├── Photography
├── Videography
├── Drone
├── Makeup
└── Decoration
```

Each requirement has its own service name, description, **budget**, `startAt`, `endAt`, status and relevant requirements. The client must specify a **separate budget for every required service**.

A professional applies (submits a proposal) only to the requirements matching skills/services they actually offer — one professional may be qualified for several requirements of the same event, or only one, while other requirements are picked up by different professionals. Each requirement is filled **independently**: one requirement being hired-out does not affect the status of any other requirement on the same event. A requirement's own status (`OPEN` → `FILLED`) reflects only that requirement, not the event as a whole.

Example:

```text
Photography → 30,000 BDT
Videography → 25,000 BDT
Drone       → 10,000 BDT
Makeup      → 15,000 BDT
Decoration  → 40,000 BDT
```

## 9. Date and Time Rules

Date/time handling is critical throughout the platform. Actual timestamps must use PostgreSQL/Prisma `DateTime` values consistently.

For every event, service, proposal and contract time range:

```text
startAt < endAt
```

must be true.

Event and service events may differ where business rules permit. The backend must validate service timing according to the platform's scheduling rules.

## 10. Professional Time Conflict Rules

A professional cannot accept overlapping service periods.

```text
existing.startAt < new.endAt
AND
existing.endAt > new.startAt
```

means the periods overlap. Therefore `10:00–12:00` and `12:00–15:00` are allowed, while `10:00–14:00` and `12:00–16:00` conflict.

The conflict check is run directly against `Contract` rows in `CONFIRMED` or `IN_PROGRESS` status for that professional — there is no separate availability/event table; the contract table is the single source of truth for a professional's booked time.

## 11. Multiple Services by One Professional

A professional is **not limited to one service per event**.

```text
Wedding
├── Photography → Professional A
├── Videography → Professional A
├── Drone → Professional A
├── Makeup → Professional B
└── Decoration → Professional B
```

Professional A can have multiple contracts for the same event as long as the service periods do not overlap. Each service requirement is treated as an independent booking requirement.

## 12. Proposal System

A proposal belongs to one professional, one event service requirement, and one professional service. A professional may propose for multiple requirements of the same event when qualified for each.

A proposal contains proposed amount, proposed `startAt`, proposed `endAt`, message/details and status.

Proposal statuses: `PENDING`, `ACCEPTED`, `REJECTED`, `WITHDRAWN`, `EXPIRED`.

## 13. Proposal and Requirement Exclusivity

Each individual event service requirement can have only **one active hired professional**. Once a requirement has an active/accepted/confirmed contract, another professional cannot be hired for that same requirement. Other unfilled requirements on the same event remain open regardless.

Cancelled/rejected/expired proposals or contracts must not unnecessarily block future hiring.

Proposal acceptance and contract creation must use transactional/race-safe logic so two professionals cannot simultaneously become the hired professional for one requirement.

## 14. Contract System

A contract is created when the client accepts a professional's proposal. A contract represents one client, one professional, one event, one specific event service requirement and one professional service, and carries agreed amount, agreed service `startAt`/`endAt`, status, terms, and lifecycle timestamps.

Contract statuses and their flow:

```text
PENDING → CONFIRMED → IN_PROGRESS → DELIVERED → COMPLETED
                                            ↘ CANCELLED
                                            ↘ DISPUTED → RESOLVED
```

- `PENDING` — contract created, awaiting confirmation (initial payment).
- `CONFIRMED` — 30% upfront payment settled; the booking is locked in and now counts toward the professional's event-conflict check.
- `IN_PROGRESS` — the service window has started.
- `DELIVERED` — the professional has finished the on-site service and marked it delivered, optionally attaching a `Deliverable` record with media/drive links. Not every service produces a deliverable (e.g. decoration, live sound management) — the professional can move straight to `DELIVERED` without one.
- `COMPLETED` — final 70% payment is settled; reviews unlock.
- `CANCELLED` / `DISPUTED` / `RESOLVED` — exception paths.

Invalid state transitions must be rejected. The contract time must be validated again when created/confirmed.

### 14.1 Cancellation Policy & Refunds

A contract can be cancelled while it is `PENDING`, `CONFIRMED` or `IN_PROGRESS`. Who cancelled it decides what happens to the money:

| Cancelled by | Notice required | Client refund |
| --- | --- | --- |
| Client | none — can cancel any time while the contract is cancellable | **No** — the client gave up the booking, the money stays in the platform escrow |
| Professional | at least **5 days (120 hours)** before `serviceStartAt` | **Yes** — the money already captured is returned in full |
| Admin | none | **Yes** — the client did nothing wrong |

- A professional inside the 5 day window gets `400` and is told to raise a dispute instead, which an admin reviews. The notice window stops a professional from dropping a booked slot on the client at the last minute.
- A professional cancellation of a contract that already captured a payment (30% advance or the full amount) creates a `Refund` record and returns the captured amount to the client's bKash account. A cancellation of an unpaid contract creates no refund.
- The cancellation is recorded with who cancelled it (`cancelledByUserId`, `cancelledByRole`) so the reason and the money trail are auditable.
- The proposal behind the contract moves with it: a professional cancellation marks the proposal item `WITHDRAWN` (the professional pulled out), a client or admin cancellation marks it `REJECTED`. The item is therefore no longer an active proposal, so the professional can propose for the re-opened requirement again.
- The client is notified with the refund amount; the professional is notified that the contract is gone and the requirement re-opens for new proposals.

Refund statuses: `PENDING` (recorded, waiting to be returned), `PROCESSING` (handed to the provider), `COMPLETED` (money back with the client), `FAILED` (settlement failed, needs a manual retry).

## 15. Payment System

The payment provider is **bKash**. Payment status must be verified by the backend; the frontend must never be trusted to declare payment success.

Payments are associated with contracts and (for record-keeping) the paying client.

### Payment event

```text
30% → Initial/Upfront Payment (unlocks CONFIRMED)
70% → Final Payment (unlocks COMPLETED)
```

The initial 30% is paid upfront to confirm the contract. The remaining 70% is paid after the service is marked `DELIVERED`.

Payment records support contract, client, payment stage, amount, currency, method, bKash transaction/reference information, status, transaction time, failure reason and metadata. Only one payment per (contract, stage) is permitted.

Payment stages: `INITIAL`, `FINAL`.
Payment statuses: `PENDING`, `PROCESSING`, `PARTIALLY_COMPLETED`, `ESCROWED`, `COMPLETED`, `FAILED`, `CANCELLED`, `REFUNDED`.

### 15.1 Escrow — the platform holds the money

The platform holds the money the client paid until the contract is completed:

```text
client pays → ESCROWED (platform holds it)
contract COMPLETED → COMPLETED (released to the professional, releasedAt is set)
contract cancelled → REFUNDED (returned to the client) or ESCROWED (client forfeit)
```

- A successful payment is `ESCROWED`, not `COMPLETED`. It only becomes `COMPLETED` when the contract reaches `COMPLETED` — the final payment completes the contract, the manual "mark as completed" does the same. Either way the escrow is released in the same transaction and `releasedAt` is stamped.
- Because the platform holds the money, a professional cannot walk away with a booking they never delivered, and a client cannot lose a payment they already made.
- A professional that cancels (with the 5 day notice) refunds the escrowed money to the client. A client that cancels keeps the money in the platform escrow — it is never released to the professional.
- The professional sees the escrowed amount as "pending payout" until the contract is completed.

### 15.1 Refunds

A `Refund` record is the audit trail of money that goes back to a client. It is created when a contract is cancelled by the professional (or by an admin) after a payment was already captured. A refund carries contract, payment, client, amount, currency, reason, status, provider reference and settlement timestamp. Only one refund per payment is permitted.

bKash tokenized checkout has no public refund endpoint. When `BKASH_REFUND_URL` is configured the refund is forwarded to it, otherwise the refund stays `PENDING` and an admin settles it through `PATCH /api/v1/admin/refunds/:id/settle`.

## 16. Service Delivery & Deliverables

Because AyojanPro is an in-person, on-location service platform, "delivery" does not always mean a file handoff — most services are physically performed at the event. A `Deliverable` exists to optionally record links (Cloudinary uploads, Google Drive folders, etc.) for services that do produce media or files.

- At most **one** `Deliverable` record per contract (title, description, an array of external links, submission timestamp).
- Creating/attaching a `Deliverable` is what the professional does when they have something to hand over; it is optional.
- Marking a contract `DELIVERED` never requires a `Deliverable` to exist — a professional can mark a purely in-person service (e.g. decoration setup, makeup) as delivered with nothing attached.
- Final payment eligibility is gated on contract status `DELIVERED`, not on the presence of a `Deliverable`.

## 17. Reviews and Ratings

After a contract reaches `COMPLETED`, both sides can review each other:

```text
Client → Professional
Professional → Client
```

A review contains rating, comment, contract, reviewer, reviewee and creation date. Each side can leave only one review per contract per direction (enforced uniquely on contract + client + professional + direction).

## 18. Dispute Management

Either client or professional can raise a dispute for issues such as client non-payment, professional no-show, service not delivered, quality failure, contractual violation, or other legitimate contract-related issues.

A dispute contains contract, raised-by user, raised-by role, reason, description, status, resolution information and timestamps.

Evidence is uploaded **in the same request** that raises the dispute (multipart files under the `evidence` field). At least **one** piece of evidence is mandatory — the backend rejects a dispute with `400 "At least one piece of evidence is required to raise a dispute"` when none is provided. Uploaded evidence file URLs are persisted as a JSON array directly on the `Dispute` row (`evidences`).

## 19. Dispute Evidence

Disputes require sufficient supporting evidence: images, documents, screenshots, other media, and descriptions. Cloudinary may be used for media storage.

There is **no separate `DisputeEvidence` model/table** — evidence is stored as a JSON array (`evidences Json @default("[]")`) directly on the `Dispute` record. Evidence is uploaded as multipart files (field `evidence`) when the dispute is raised via `POST /api/v1/dispute/contracts/:id`, and at least one file is required. Evidence belongs to the dispute → contract it was raised against and must be protected from unauthorized access.

## 20. Admin Dispute Resolution

Admin can inspect event, service requirement, proposal, contract, payment records, user information, evidence and completion information before resolving a dispute.

Dispute statuses: `OPEN`, `UNDER_REVIEW`, `RESOLVED`, `REJECTED`, `CLOSED`.

## 21. Notifications and Email

Notifications carry a `type` (`APPLICATION`, `PROPOSAL`, `CONTRACT`, `PAYMENT`, `SERVICE`, `REVIEW`, `DISPUTE`, `SYSTEM`) and cover application decisions, new/updated proposals, contracts, payment requirements/results, delivery, completion, reviews and disputes.

Nodemailer may be used for transactional email mirroring the same events.

## 22. Media Storage

Cloudinary may be used for profile images, professional portfolios, deliverable links, and dispute evidence. The database stores URLs/references and metadata rather than large binary files.

## 23. Matching

Since AyojanPro is a local platform, location matters. Matching may consider: service, skills, location, service event (no overlap with existing contracts), rating, experience, portfolio, pricing, and `acceptingBookings`. Professionals who cannot actually serve the required time period (based on existing confirmed contracts) should not be recommended as suitable matches.

## 24. Core Business Rules

1. **Role restriction:** only clients directly register through the normal registration flow.
2. **Professional gating:** a `Professional` record exists from the moment of application, but only an `APPROVED` status allows active platform use.
3. **Service-specific budget:** every event service requirement has its own budget.
4. **Service-specific event:** every event service requirement has its own service time range.
5. **One active professional per requirement:** one requirement cannot have multiple simultaneously active hired professionals.
6. **Multiple services per professional:** one professional can be hired for multiple requirements of the same event.
7. **No time overlap:** a professional cannot have overlapping `CONFIRMED`/`IN_PROGRESS` contracts, checked directly against the contract table.
8. **Booking preference:** a professional not accepting new bookings cannot accept a new contract.
9. **Payment verification:** payment success is verified by the backend.
10. **Two-stage payment:** 30% unlocks `CONFIRMED`, 70% unlocks `COMPLETED`.
11. **Delivery is not deliverable-dependent:** a contract can move to `DELIVERED` with or without a `Deliverable` record.
12. **Review eligibility:** reviews are available only after a contract is `COMPLETED`.
13. **Dispute evidence:** disputes require sufficient supporting information/evidence; at least one piece of evidence is mandatory and stored as a JSON array on the `Dispute` record.
14. **Transactional booking:** proposal acceptance and contract creation must protect against race conditions.
15. **Date/time validation:** every relevant workflow transition validates timestamps and scheduling conflicts.
16. **Cancellation notice window:** a professional may only cancel a contract at least 5 days before the service starts; inside that window a dispute is the route.
17. **Refund on professional cancellation:** a contract cancelled by the professional (or by an admin) refunds the captured payment to the client; a contract cancelled by the client is not refunded.
18. **Refund audit trail:** every refund is recorded as a `Refund` row with its own status so an outstanding refund is always visible.
19. **Platform escrow:** a captured payment is `ESCROWED` and held by the platform until the contract is completed, then released to the professional; a cancelled contract returns the money to the client instead.

## 25. Time-Sensitive Workflow Validation

The backend must handle cases including:

- Proposal accepted after service time has passed.
- Contract created with a conflicting confirmed contract.
- Professional disables `acceptingBookings` before acceptance.
- Requirement is already filled when another proposal is accepted.
- Contract cancellation frees the professional's event.
- Proposal expires before acceptance.
- Final payment attempted before the contract is `DELIVERED`.
- Final payment attempted after a dispute is opened.
- Simultaneous booking attempts for overlapping periods.

These checks must be performed server-side.

## 26. Database Architecture

Technology:

- PostgreSQL
- Prisma ORM 7 (multi-file schema)

Major domains:

```text
Authentication
    ├── User
    └── Client

Professional Management
    ├── Professional        (also carries application/review state)
    ├── ProfessionalService
    ├── Skill
    ├── ProfessionalSkill
    ├── Experience
    └── PortfolioItem

Event Management
    ├── Event
    └── EventServiceRequirement

Hiring
    ├── Proposal
    └── Contract

Payment
    └── Payment

Service Delivery
    └── Deliverable      (one-to-one, optional, per contract)

Feedback
    └── Review

Dispute
    └── Dispute        (evidences stored as a JSON array on the dispute row)

Communication
    └── Notification
```

**No `AuditLog`, `ProfessionalApplication`, `AvailabilityRule`, `TimeOff`, `Revision`, or `DisputeEvidence` models are used** — applications are folded into `Professional`, delivery is a status + one optional `Deliverable` row rather than a revision workflow, and dispute evidence is a JSON field on `Dispute` rather than a separate table.

## 27. Core Relationships

```text
User
├── Client
│   └── Events
│       └── EventServiceRequirements
│           ├── Proposals
│           └── Contract
│
└── Professional
    ├── Services
    ├── Skills
    ├── Experience
    ├── Portfolio
    ├── Proposals
    └── Contracts

Contract
├── Payments (INITIAL, FINAL)
├── Deliverable (0 or 1)
├── Reviews (client→professional, professional→client)
└── Disputes (evidence held on the dispute row itself as `evidences` JSON)
```

## 28. API Architecture

Base API path:

```text
/api/v1
```

Architecture:

```text
Routes → Middleware → Controller → Service → Prisma → PostgreSQL
```

Routes define endpoints and route-level middleware. Middleware handles authentication, authorization, validation, errors, rate limiting where necessary and file handling where required. Controllers remain thin and handle request extraction, service calls and responses. Services contain business logic, transactions, scheduling checks, permissions, payment verification and workflow transitions. Prisma handles database access.

## 29. API Endpoints Reference

### Auth (`/api/v1/auth`)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/register` | Client registration (credentials) |
| POST | `/verify-email` | Verify client email with OTP |
| POST | `/login` | Credential login |
| POST | `/google` | Google OAuth login |
| POST | `/refresh-token` | Refresh access token |
| POST | `/forgot-password` | Request password reset |
| POST | `/reset-password` | Reset password with token |
| GET | `/me` | Get current authenticated user |

### Professional (`/api/v1/professional`)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/apply-as-professional` | Create `User` (role `PROFESSIONAL`) + `Professional` profile, `status = PENDING` (with resume & additional files upload) |
| POST | `/apply-as-professional/verify-email` | Verify professional email with OTP |
| POST | `/approve-professional` | Approve professional application (Admin) |
| GET | `/all-professionals` | List all professionals (Admin) |
| PATCH | `/update-my-profile` | Update own professional profile |
| GET | `/public/all-Professionals` | Browse `APPROVED` professionals (public) |
| GET | `/public/:professionalId` | Get professional public profile |
| POST | `/service` | Add professional service |
| GET | `/me/services` | List own services |
| PATCH | `/service/:id` | Update service |
| DELETE | `/service/:id` | Remove service |
| POST | `/skill` | Add skill |
| DELETE | `/skill/:id` | Remove skill |
| POST | `/experience` | Add experience |
| PATCH | `/experience/:id` | Update experience |
| DELETE | `/experience/:id` | Remove experience |
| POST | `/portfolio` | Add portfolio item (with media upload) |
| GET | `/me/portfolio` | List own portfolio items |
| PATCH | `/portfolio/:id` | Update portfolio item |
| DELETE | `/portfolio/:id` | Remove portfolio item |

### Client (`/api/v1/client`)

| Method | Endpoint | Description |
|---|---|---|
| PATCH | `/my-profile` | Update own client profile |

### Events (`/api/v1/event`)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/` | Create event (Client) |
| POST | `/services/:eventId` | Add service requirement to event |
| GET | `/all-events` | Browse published events (Professional/Admin) |
| PATCH | `/update/:eventId` | Update event (Client) |
| GET | `/:eventId/required-services` | List service requirements for event |
| PATCH | `/update/:eventId/services/:serviceId` | Update service requirement |
| DELETE | `/:eventId/services/:serviceId` | Remove service requirement |
| GET | `/:eventId` | Get event detail |
| PATCH | `/publish-event/:eventId` | Publish event |
| DELETE | `/:eventId` | Delete event (Client/Admin) |

### Proposals (`/api/v1/proposal`)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/events/:eventId` | Submit proposal for event requirements (Professional) |
| GET | `/requirements/:requirementId` | List proposals for a requirement (Client/Admin) |
| GET | `/:id` | Get proposal detail |
| PATCH | `/:id/accept` | Accept proposal → creates Contract (Client) |
| PATCH | `/:id/reject` | Reject proposal (Client) |
| PATCH | `/:id/withdraw` | Withdraw proposal (Professional) |

### Contracts (`/api/v1/contract`)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | List own contracts (Client/Professional/Admin) |
| GET | `/:id` | Get contract detail |
| PATCH | `/:id/cancel` | Cancel contract |
| POST | `/:id/deliverable` | Attach deliverable links (Professional) |
| GET | `/:id/deliverable` | Get the contract's deliverable, if any |
| PATCH | `/:id/complete` | Mark `COMPLETED` (Client/Admin) |

### Payments (`/api/v1/payment`)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/contracts/:id/initial` | Initiate 30% upfront payment (Client) |
| POST | `/contracts/:id/final` | Initiate 70% final payment — requires `DELIVERED` (Client) |
| GET | `/bkash/callback` | bKash payment callback (public; verified server-side) |
| GET | `/contracts/:id` | List payments for a contract (all roles) |

### Reviews (`/api/v1/review`)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/contracts/:id` | Leave review after contract `COMPLETED` (Client or Professional) |
| GET | `/professionals` | Reviews about the authenticated professional |
| GET | `/clients` | Reviews about the authenticated client |

### Disputes (`/api/v1/dispute`)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/contracts/:id` | Raise dispute — multipart `evidence` files (1+ required), body `reason` (min 3) and `description` (min 10) (Client/Professional) |
| GET | `/` | List disputes (Admin) |
| GET | `/:id` | Get dispute detail (parties + Admin) |
| PATCH | `/:id/status` | Update dispute status (Admin) |
| PATCH | `/:id/resolve` | Resolve dispute (Admin) |

### Notifications (`/api/v1/notification`)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | List notifications (all roles) |
| PATCH | `/read-all` | Mark all as read |
| PATCH | `/:id/read` | Mark as read |

### Admin (`/api/v1/admin`)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/users` | List all users |
| GET | `/events` | List all events |
| GET | `/contracts` | List all contracts |
| GET | `/payments` | List all payments |
| PATCH | `/users/:id/status` | Activate/suspend user |

### User (`/api/v1/user`)

| Method | Endpoint | Description |
|---|---|---|
| PATCH | `/profile-image` | Upload/update profile image (all roles) |

### Analytics (`/api/v1/analytics`)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/client-analytics` | Client dashboard analytics (Client) |
| GET | `/professional-analytics` | Professional dashboard analytics (Professional) |
| GET | `/admin-analytics` | Platform analytics (Admin) |

### List endpoints and query parameters

All list endpoints share a common query interface (`IQuery`): `page`, `limit`, `sortBy`, `sortOrder`, `searchTerm` (where applicable) plus endpoint-specific filters below.

| Endpoint | Specific query parameters |
|---|---|
| `GET /api/v1/dispute` (Admin) | `status` = `OPEN` \| `UNDER_REVIEW` \| `RESOLVED` \| `REJECTED` \| `CLOSED` |
| `GET /api/v1/admin/users` | `role` = `CLIENT` \| `PROFESSIONAL` \| `ADMIN`, `status` = `ACTIVE` \| `DELETED` \| `SUSPENDED` \| `BLOCKED`, `search` |
| `GET /api/v1/admin/events` | `status` = `DRAFT` \| `PUBLISHED` \| `IN_PROGRESS` \| `COMPLETED` \| `CANCELLED` |
| `GET /api/v1/admin/contracts` | `status` = `PENDING` \| `CONFIRMED` \| `IN_PROGRESS` \| `DELIVERED` \| `COMPLETED` \| `CANCELLED` \| `DISPUTED` \| `RESOLVED` |
| `GET /api/v1/admin/payments` | `status` = `PENDING` \| `PROCESSING` \| `PARTIALLY_COMPLETED` \| `ESCROWED` \| `COMPLETED` \| `FAILED` \| `CANCELLED` \| `REFUNDED`, `stage` = `INITIAL` \| `FINAL` |
| `GET /api/v1/admin/refunds` | `status` = `PENDING` \| `PROCESSING` \| `COMPLETED` \| `FAILED` |
| `PATCH /api/v1/admin/refunds/:id/settle` | Settle a refund manually — body: `status` = `COMPLETED` \| `FAILED`, `note?`, `reference?` |
| `GET /api/v1/event/all-events` | `searchTerm`, `clientId`, `email`, `status` |
| `GET /api/v1/professional/all-professionals` (Admin) | `searchTerm`, `professionalTitle`, `city`, `country`, `minExperience`, `maxExperience`, `minRating`, `acceptingBookings`, `status` |
| `GET /api/v1/professional/public/all-Professionals` | `searchTerm`, `professionalTitle` |
| `GET /api/v1/review/professionals` / `GET /api/v1/review/clients` | `page`, `limit` |
| `GET /api/v1/notification` | `isRead` = `true` \| `false` |

## 30. Validation

Validation is required for authentication, profiles, professional applications (on the `Professional` model), services, skills, experience, portfolio, events, service requirements, proposals, contracts, payments, deliverables, reviews, disputes and evidence.

Validation must include date/time consistency and business rules.

## 31. Error Handling

The API should return consistent errors for validation, authentication, authorization, missing resources, duplicates, scheduling conflicts, invalid workflow transitions, payment failures, already-filled requirements, dispute restrictions and external service failures.

## 32. Security Requirements

The backend must:

- Hash passwords securely.
- Validate authentication tokens.
- Enforce role-based access control, including gating `PENDING`/`REJECTED` professionals from professional-only actions.
- Validate resource ownership.
- Validate uploaded files.
- Protect sensitive payment information.
- Never trust frontend payment status.
- Protect payment/webhook verification endpoints.
- Apply rate limiting to sensitive endpoints where appropriate.
- Avoid exposing sensitive user information.

## 33. Optional Infrastructure

### Redis

Optional uses include caching, rate limiting, temporary state and performance optimization.

### Cloudinary

Media storage.

### Nodemailer

Transactional email.

### bKash

Payment processing.

## 34. End-to-End Client Flow

```text
Register/Login
      ↓
Create Profile
      ↓
Create Event
      ↓
Add Required Services (budget + service time each)
      ↓
Publish Event
      ↓
Receive Proposals
      ↓
Accept Proposal → Contract Created
      ↓
Pay 30%
      ↓
Service Delivered On-Site
      ↓
Professional Marks Contract Delivered (± Deliverable)
      ↓
Pay 70% → Contract Completed
      ↓
Review Professional
```

## 35. End-to-End Professional Flow

```text
Submit Professional Profile (User + Professional, status=PENDING)
      ↓
Admin Approval (status=APPROVED)
      ↓
Complete Profile / Add Services, Skills, Experience, Portfolio
      ↓
Enable Accepting Bookings
      ↓
Browse Events
      ↓
Submit Proposals for Matching Requirements
      ↓
Proposal Accepted → Contract Confirmed
      ↓
Provide Service On-Site
      ↓
Submit Deliverable (if applicable) & Mark Delivered
      ↓
Receive Final Payment → Contract Completed
      ↓
Review Client
```

## 36. End-to-End Admin Flow

```text
Review Pending Professionals
          ↓
Approve/Reject
          ↓
Monitor Events, Proposals, Contracts, Payments
          ↓
Review Disputes & Evidence
          ↓
Resolve Disputes
```

## 37. Core Business Example

```text
Event: Wedding
Overall Time: 4:00 PM → 10:00 PM

Photography   → Budget: 30,000 BDT   Time: 4:00 PM → 10:00 PM
Videography   → Budget: 25,000 BDT   Time: 4:00 PM → 10:00 PM
Drone         → Budget: 10,000 BDT   Time: 5:00 PM → 7:00 PM
Makeup        → Budget: 15,000 BDT   Time: 2:00 PM → 5:00 PM
Decoration    → Budget: 40,000 BDT   Time: 1:00 PM → 4:00 PM
```

Possible hiring:

```text
Professional A
├── Photography
├── Videography
└── Drone

Professional B
├── Makeup
└── Decoration
```

Valid because each professional is qualified for the specific requirement they applied to, is `APPROVED` and `acceptingBookings`, and has no overlapping confirmed contracts. Photography/Videography/Drone and Makeup/Decoration are filled independently — one requirement being hired-out never affects another requirement's status.

## 38. Final Project Objective

AyojanPro should provide a reliable local event-service platform where:

- Clients organize events with independently budgeted and eventd services.
- Professionals apply directly through their own profile record and become active only after admin approval.
- Professionals can provide multiple services and be hired for multiple requirements of one event.
- Different professionals can independently fill different requirements of the same event.
- Scheduling conflicts are prevented using the contract table as the single source of truth.
- Contracts formalize agreements and move through a clear `PENDING → CONFIRMED → IN_PROGRESS → DELIVERED → COMPLETED` lifecycle.
- Payments follow 30% upfront and 70% final, both verified server-side via bKash.
- Delivery is decoupled from payment for services with no tangible handoff.
- Completed contracts enable mutual reviews.
- Disputes can be raised with evidence and resolved by admin.
- The architecture remains modular, maintainable, secure and scalable.

The implementation must prioritize **business-rule correctness, data integrity, role-based authorization, date/time consistency, transactional safety and reliable payment verification**.