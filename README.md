# AyojanPro

A local event-service booking platform connecting **clients** who organize events with **verified professionals** who perform event services on-site (photography, videography, decoration, makeup, sound, etc.).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework | Express.js |
| ORM | Prisma 7 (multi-file schema) |
| Database | PostgreSQL |
| Auth | JWT + Google OAuth 2.0 |
| Payments | bKash |
| Media | Cloudinary |
| Email | Nodemailer |
| Cache / Rate Limit | Redis (optional) |

---

## Architecture

```
Routes → Middleware → Controller → Service → Prisma → PostgreSQL
```

- **Routes** — define endpoints and attach middleware
- **Middleware** — auth, RBAC, validation, rate limiting, file handling
- **Controllers** — thin; extract request data, call service, return response
- **Services** — all business logic, transactions, scheduling checks, payment verification
- **Prisma** — database access layer

---

## Roles

| Role | How the account is created |
|---|---|
| `CLIENT` | Self-register (credentials or Google OAuth) with email verification |
| `PROFESSIONAL` | Applies directly by creating a `User` + `Professional` profile (`status = PENDING`) → Admin flips status to `APPROVED`/`REJECTED` |
| `ADMIN` | Platform-seeded; not publicly registrable |

> There is no separate application table — the `Professional` model **is** the application. It carries `status`, `resume`, `rejectionReason`, `reviewedById`, `reviewedAt` alongside the normal profile fields. A `PENDING`/`REJECTED` professional is blocked from any professional-only action even though the row already exists.

---

## Core Workflow

```
Client creates Event
  └─ Adds Service Requirements (each with own budget + time range)
       └─ Qualified Professionals submit Proposals for the requirements they match
            └─ Client accepts a Proposal → Contract created (PENDING)
                 └─ Client pays 30% → Contract CONFIRMED
                      └─ Service performed on-site → Contract IN_PROGRESS
                           └─ Professional marks service DELIVERED (± Deliverable links)
                                └─ Client pays 70% → Contract COMPLETED
                                     └─ Mutual reviews unlock
```

---

## Database Models

```
User ─┬─ Client ─── Event ─── EventServiceRequirement ─┬─ Proposal
      │                                                  └─ Contract
      └─ Professional ─┬─ ProfessionalService
                       ├─ Skill / ProfessionalSkill
                       ├─ Experience
                       ├─ PortfolioItem
                       ├─ Proposal
                       └─ Contract

Contract ─┬─ Payment (INITIAL, FINAL)
           ├─ Deliverable (0 or 1, optional links only)
           ├─ Review (client→professional, professional→client)
           └─ Dispute (evidences stored as a JSON array on the dispute row)

Notification
```

No `ProfessionalApplication`, `AvailabilityRule`, `TimeOff`, `Revision`, `AuditLog`, or `DisputeEvidence` models — professional intake is a status field on `Professional`, scheduling conflicts are checked directly against `Contract` rows, delivery is a status + one optional record rather than a versioned revision flow, and dispute evidence is a JSON field on `Dispute` (`evidences Json @default("[]")`) rather than a separate table.

---

## API Reference

Base path: `/api/v1`

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/register` | Client registration |
| POST | `/auth/verify-email` | Verify client email with OTP |
| POST | `/auth/login` | Credential login (Client / Professional / Admin) |
| POST | `/auth/logout` | Logout (clear session) |
| POST | `/auth/google` | Google OAuth login |
| POST | `/auth/refresh-token` | Refresh access token |
| POST | `/auth/forgot-password` | Request password reset (OTP to email) |
| POST | `/auth/reset-password` | Reset password with OTP (`email`, `otp`, `newPassword`, `confirmPassword`) |
| GET | `/auth/me` | Get current authenticated user |

### Professionals (profile + application in one)
| Method | Endpoint | Description |
|---|---|---|
| POST | `/professional/apply-as-professional` | Create `User` (role `PROFESSIONAL`) + `Professional` profile, `status = PENDING` (with resume & additional files upload) |
| POST | `/professional/apply-as-professional/verify-email` | Verify professional email with OTP |
| POST | `/professional/approve-professional` | Approve professional application (Admin) |
| GET | `/professional/all-professionals` | List all professionals (Admin) |
| PATCH | `/professional/update-my-profile` | Update own profile |
| GET | `/professional/public/all-Professionals` | Browse `APPROVED` professionals (public) |
| GET | `/professional/public/:professionalId` | Get professional public profile |
| POST | `/professional/service` | Add service |
| GET | `/professional/me/services` | List own services |
| PATCH | `/professional/service/:id` | Update service |
| DELETE | `/professional/service/:id` | Remove service |
| POST | `/professional/skill` | Add skill |
| DELETE | `/professional/skill/:id` | Remove skill |
| POST | `/professional/experience` | Add experience |
| PATCH | `/professional/experience/:id` | Update experience |
| DELETE | `/professional/experience/:id` | Remove experience |
| POST | `/professional/portfolio` | Add portfolio item (with media upload) |
| GET | `/professional/me/portfolio` | List own portfolio items |
| PATCH | `/professional/portfolio/:id` | Update portfolio item |
| DELETE | `/professional/portfolio/:id` | Remove portfolio item |

### Client Profile
| Method | Endpoint | Description |
|---|---|---|
| PATCH | `/client/my-profile` | Update own profile |

### Events
| Method | Endpoint | Description |
|---|---|---|
| POST | `/event` | Create event (Client) |
| POST | `/event/services/:eventId` | Add service requirement |
| GET | `/event/all-events` | Browse published events (Professional/Admin) |
| PATCH | `/event/update/:eventId` | Update event (Client) |
| GET | `/event/:eventId/required-services` | List service requirements for event |
| PATCH | `/event/update/:eventId/services/:serviceId` | Update service requirement |
| DELETE | `/event/:eventId/services/:serviceId` | Remove service requirement |
| GET | `/event/:eventId` | Get event detail |
| PATCH | `/event/publish-event/:eventId` | Publish event |
| DELETE | `/event/:eventId` | Delete event (Client/Admin) |

### Event Service Requirements
| Method | Endpoint | Description |
|---|---|---|
| POST | `/event/services/:eventId` | Add service requirement |
| GET | `/event/:eventId/required-services` | List requirements |
| PATCH | `/event/update/:eventId/services/:serviceId` | Update requirement |
| DELETE | `/event/:eventId/services/:serviceId` | Remove requirement |

### Proposals
| Method | Endpoint | Description |
|---|---|---|
| POST | `/proposal/events/:eventId` | Submit proposal (Professional) |
| GET | `/proposal/requirements/:requirementId` | List proposals (Client/Admin) |
| GET | `/proposal/:id` | Get proposal detail |
| PATCH | `/proposal/:id/accept` | Accept proposal → creates Contract (Client) |
| PATCH | `/proposal/:id/reject` | Reject proposal (Client) |
| PATCH | `/proposal/:id/withdraw` | Withdraw proposal (Professional) |

### Contracts
| Method | Endpoint | Description |
|---|---|---|
| GET | `/contract` | List own contracts |
| GET | `/contract/:id` | Get contract detail |
| PATCH | `/contract/:id/cancel` | Cancel contract |
| POST | `/contract/:id/deliverable` | Attach deliverable links (Professional) |
| GET | `/contract/:id/deliverable` | Get the contract's deliverable, if any |
| PATCH | `/contract/:id/complete` | Mark `COMPLETED` (Client/Admin) |

### Payments
| Method | Endpoint | Description |
|---|---|---|
| POST | `/payment/contracts/:id/initial` | Initiate 30% upfront payment (Client) |
| POST | `/payment/contracts/:id/final` | Initiate 70% final payment — requires `DELIVERED` (Client) |
| GET | `/payment/bkash/callback` | bKash payment callback (public, verified server-side) |
| GET | `/payment/contracts/:id` | List payments for a contract (all roles) |

### Reviews
| Method | Endpoint | Description |
|---|---|---|
| POST | `/review/contracts/:id` | Leave review after contract `COMPLETED` (Client or Professional) |
| GET | `/review/professionals` | Reviews about the authenticated professional |
| GET | `/review/clients` | Reviews about the authenticated client |

### Disputes
| Method | Endpoint | Description |
|---|---|---|
| POST | `/dispute/contracts/:id` | Raise dispute — multipart `evidence` files (1+ required), body `reason` (min 3) and `description` (min 10) (Client/Professional) |
| GET | `/dispute` | List disputes (Admin) |
| GET | `/dispute/:id` | Get dispute detail (parties + Admin) |
| PATCH | `/dispute/:id/status` | Update dispute status (Admin) |
| PATCH | `/dispute/:id/resolve` | Resolve dispute (Admin) |

### Notifications
| Method | Endpoint | Description |
|---|---|---|
| GET | `/notification` | List notifications |
| PATCH | `/notification/read-all` | Mark all as read |
| PATCH | `/notification/:id/read` | Mark as read |

### Admin
| Method | Endpoint | Description |
|---|---|---|
| GET | `/admin/users` | List all users |
| GET | `/admin/events` | List all events |
| GET | `/admin/contracts` | List all contracts |
| GET | `/admin/payments` | List all payments |
| PATCH | `/admin/users/:id/status` | Activate/suspend user |

### User (Profile Image)
| Method | Endpoint | Description |
|---|---|---|
| PATCH | `/user/profile-image` | Upload/update profile image (all roles) |

### Analytics
| Method | Endpoint | Description |
|---|---|---|
| GET | `/analytics/client-analytics` | Get client analytics (Client) |
| GET | `/analytics/professional-analytics` | Get professional analytics (Professional) |
| GET | `/analytics/admin-analytics` | Get admin platform analytics (Admin) |

### List endpoints & query parameters

All list endpoints share the global `IQuery` interface: `page`, `limit`, `sortBy`, `sortOrder`, `searchTerm` (where applicable), plus:

| Endpoint | Specific query parameters |
|---|---|
| `GET /dispute` (Admin) | `status` = `OPEN` \| `UNDER_REVIEW` \| `RESOLVED` \| `REJECTED` \| `CLOSED` |
| `GET /admin/users` | `role` = `CLIENT` \| `PROFESSIONAL` \| `ADMIN`, `status` = `ACTIVE` \| `DELETED` \| `SUSPENDED` \| `BLOCKED`, `search` |
| `GET /admin/events` | `status` = `DRAFT` \| `PUBLISHED` \| `IN_PROGRESS` \| `COMPLETED` \| `CANCELLED` |
| `GET /admin/contracts` | `status` = `PENDING` \| `CONFIRMED` \| `IN_PROGRESS` \| `DELIVERED` \| `COMPLETED` \| `CANCELLED` \| `DISPUTED` \| `RESOLVED` |
| `GET /admin/payments` | `status` = `PENDING` \| `PROCESSING` \| `PARTIALLY_COMPLETED` \| `COMPLETED` \| `FAILED` \| `CANCELLED` \| `REFUNDED`, `stage` = `INITIAL` \| `FINAL` |
| `GET /event/all-events` | `searchTerm`, `clientId`, `email`, `status` = `OPEN` \| `PARTIALLY_FILLED` \| `FILLED` \| `IN_PROGRESS` \| `COMPLETED` \| `CANCELLED` |
| `GET /professional/all-professionals` (Admin) | `searchTerm`, `professionalTitle`, `city`, `country`, `minExperience`, `maxExperience`, `minRating`, `acceptingBookings`, `status` |
| `GET /professional/public/all-Professionals` | `searchTerm`, `professionalTitle` |
| `GET /review/professionals` / `GET /review/clients` | `page`, `limit` |
| `GET /notification` | `isRead` = `true` \| `false` |

---

## Key Business Rules

**Professional gating**
- Applying = creating the `Professional` record itself, `status = PENDING`.
- Only `status = APPROVED` unlocks professional-only actions (browsing events, proposing, contracting).
- Email verification required for both clients and professionals.

**Scheduling**
- Every `EventServiceRequirement` has its own `startAt`/`endAt` and budget, independent of the parent event's time range.
- `startAt < endAt` is enforced on every proposal, contract, and service.
- A professional cannot hold two `CONFIRMED`/`IN_PROGRESS` contracts whose time ranges overlap: `existing.startAt < new.endAt AND existing.endAt > new.startAt`. This check runs directly against the `Contract` table — there is no separate availability model.

**Hiring**
- One requirement → only one active hired professional at a time; other requirements on the same event fill independently.
- One professional → can hold multiple contracts for the same event provided their service periods don't overlap.
- `acceptingBookings = false` blocks new contracts but does not invalidate existing confirmed ones.
- Proposal acceptance and contract creation are wrapped in a database transaction to prevent race conditions.

**Delivery**
- Contract lifecycle: `PENDING → CONFIRMED → IN_PROGRESS → DELIVERED → COMPLETED` (plus `CANCELLED` / `DISPUTED` / `RESOLVED`).
- A `Deliverable` (title, description, array of external links) is optional and capped at one per contract.
- Marking `DELIVERED` never requires a `Deliverable` to exist — many services (decoration, makeup, live sound) have nothing to hand over.

**Payments**
- 30% paid upfront to reach `CONFIRMED`; 70% paid once the contract is `DELIVERED`, moving it to `COMPLETED`.
- Payment success is **always** verified server-side via bKash callback — the frontend result is never trusted.
- Final payment is blocked if a dispute is open on the contract.
- Only one payment per (contract, stage) is permitted.

**Reviews**
- Reviews unlock only once the contract is `COMPLETED`.
- One review per direction (Client→Professional, Professional→Client) per contract.

**Disputes**
- Either party may raise a dispute; at least one piece of evidence (multipart upload, stored as a JSON array on the dispute) is required.
- Admin inspects all contract, payment, and evidence records before resolving.

---

## Environment Variables

```env
DATABASE_URL=
JWT_SECRET=
JWT_REFRESH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
BKASH_APP_KEY=
BKASH_APP_SECRET=
BKASH_USERNAME=
BKASH_PASSWORD=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
REDIS_URL=          # optional
```

---

## Getting Started

```bash
# Install dependencies
npm install

# Run database migrations
npx prisma migrate dev

# Seed admin account
npm run seed

# Start development server
npm run dev
```