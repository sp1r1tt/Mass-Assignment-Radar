# Mass Assignment Radar — Mutation-based Scanner

![Radar](/radar.jpg)

A Caido plugin that helps detect mass assignment by automatically mutating JSON requests, comparing responses, and optionally confirming persistence of the result.

Built for penetration testers and security researchers: you pick one baseline JSON request, set parameters, and run the scan. The plugin generates multiple mutated variants, sends them, and shows which response changes look suspicious.

## What the scanner does

1. Takes a baseline request from Caido by Request ID.
2. Ensures the request body is JSON and that it is a JSON object.
3. Creates several “mutations” (request copies) by adding new JSON fields that were not present in the baseline (e.g., `isAdmin`, `role`, `permissions`) with values like `true`, `"admin"`, or `1`.
4. Sends these mutations and compares responses to the baseline:
   - whether the status code changes;
   - whether the injected field appears in the JSON response.
5. If Confirm persistence is enabled, it replays the baseline and checks whether the injected field “stuck” (persistence).

### Running in Caido

- If the application requires authentication, log in in a browser proxied through Caido first, so the requests are “real” and responses are meaningful.

## Choosing the right request to scan

Best candidates are JSON requests that change account/profile/roles/settings state:
- profile updates (email, name, preferences);
- role/permission changes (if present);
- cart/order/address updates;
- any POST/PUT/PATCH to API endpoints.

Important: if the server strictly validates input JSON and whitelists fields, you may get no findings — that’s fine.

## Scanner screen: field-by-field guide

Below is what each control does in the plugin page and how it affects the result.

### Requests loading

**HTTPQL filter (optional)**
- Filter for searching requests in Caido history using HTTPQL.
- If empty: the latest requests are selected by the Limit.
- Examples:
  - `req.method.eq:"POST"`
  - `req.url.contains:"/api"`
  - `req.header.content-type.contains:"application/json"`

**Limit**
- How many latest requests to consider (1–5000).
- Larger values broaden selection but make loading slower.

**Load JSON requests**
- Loads the table of requests filtered by HTTPQL and Limit.
- Only requests with JSON Content-Type are included.

**Use selected**
- Copies the selected row’s ID into the Request ID field below.

### Requests table

The table shows brief info:
- Created — when the request was captured in Caido.
- Method — HTTP method (GET/POST/PUT/PATCH, etc.).
- URL — request address.
- Has resp — whether this request has a saved response.
- ID — the identifier the scanner needs.

### Running the scan

**Request ID**
- The main identifier: which request will be the baseline.
- Typically you pick a request above and click Use selected.

**Max mutations**
- Maximum number of mutations (request variants) to send (1–256).
- More means wider coverage but longer scans and more traffic.
- If you enabled multiple Value modes, a single Candidate field may generate multiple mutations (e.g., `isAdmin` with `true` and `1` gives two mutations).

**Run Scan**
- Starts the scan: baseline → mutations → analysis → findings.

### Mutation settings

**Include built-in candidate fields**
- Enables a standard list of fields commonly related to privileges and limits:
  - `isAdmin`, `admin`, `is_staff`, `isStaff`, `isSuperuser`, `role`, `roles`, `permissions`, `tier`, `plan`, `credits`, `generationCredits`
- If you are unsure what to put into Candidate fields, leave this enabled.

**Candidate fields (comma or newline separated)**
- Your additional suspicious fields.
- Supports **dot notation** for nested objects. If you enter `features.unlimited`, the scanner automatically creates `{"features": {"unlimited": true}}`.
- You can use commas or newlines.
- Examples:
  - `is_admin, superuser, accessLevel`
  - `features.unlimitedGenerations, profile.role`
  - `canDeleteUsers`

The scanner tries to add only fields that were absent in the baseline JSON. If a field already exists in the baseline, it won’t be mutated.

**Value modes**
- Which values to inject for candidate fields:
  - `true` — useful for boolean flags (`isAdmin`, `isStaff`).
  - `"admin"` — useful for roles (`role`, `tier`, `plan`).
  - `1` — useful for numeric flags/access levels.
  - `+1` / `-1` — increment/decrement existing numeric fields (works only with Mutate existing fields enabled).
- Multiple modes can be enabled at the same time.
- If all modes are disabled, the scanner still injects `true` (to avoid an empty scan).

**Custom values (comma or newline separated)**
- Your specific values to test (e.g., `premium`, `enterprise`, `9999`).
- Supports **JSON format**. If you enter `{"unlimited": true}`, the scanner injects this object as-is.
- Each value creates a separate mutation for each field.

**Confirm persistence**
- After a Reflected signal is found, the scanner replays the baseline and checks whether the injected field is still present.
- Helps distinguish random echoes from persistent state changes.

**Verification request follow‑up**
- Performs an additional verification request after each mutation.
- **Method**: HTTP method for verification (GET, POST, etc.).
- **Verification URL**: Endpoint to call to verify state (e.g., `/me` or `/generate-image`).
- **Body**: Request body for POST/PUT verification (optional).
- **Delay (ms)**: Delay before the verification request (0–10000 ms).

**Persistence delay (ms)**
- Delay before replaying the baseline during Confirm persistence (0–10000 ms).
- Increase if the server applies changes asynchronously.

### Results filter

**Filter kinds**
- Show/hide different types of findings:
  - Reflected
  - Persisted
  - StateChanged (state change detected via follow‑up)
  - CodeChanged
  - NonJsonResponse
  - NoResponse

## Reading results (Findings table)

Each row is one mutation (which field and value were injected) and what the scanner observed in the responses.

Columns:
- Kind — type of signal (see below).
- Field / Value — which field and value were injected.
- Baseline / Mutated / Persisted — status codes of the baseline, the mutated request (a copy of the baseline with injected fields; marked with header X‑Mass‑Assignment‑Radar: mutated), and the baseline replay (if Confirm persistence is enabled).
- Details — brief explanation of what happened.
- Request ID — the original Request ID used for the scan.

## Finding types (what they mean)

- Reflected: the injected field appears in the JSON response, although it wasn’t in the baseline.
  - Common signal that the server processed a new field without whitelist validation.
- Persisted: the injected field is still present after replaying the baseline (with Confirm persistence enabled).
  - Strong signal that a change may have persisted.
- StateChanged: a system state change is detected via a follow‑up verification request.
  - The strongest signal: injection in one endpoint changed logic or data in another.
  - The scanner uses an **intelligent diff**: it compares all text and numeric fields while automatically ignoring “noise” (dynamic IDs, timestamps, tokens, image links). This helps find even “blind” vulnerabilities.
- CodeChanged: the mutation’s response status code differs from the baseline (e.g., 200 → 403 or 200 → 500).
  - May indicate different logic branches, validation errors, or successful/unsuccessful bypass.
- NonJsonResponse: the mutation’s response cannot be parsed as JSON.
  - Common on error HTML pages/redirects.
- NoResponse: the request failed or received no response (network errors, blocks, timeouts, etc.).

## Export to Caido Findings

Buttons at the bottom:
- Export selected — exports only selected rows.
- Export all — exports all currently visible rows given Filter kinds.

After export, entries appear in Caido Findings. The plugin adds a dedupeKey to avoid creating duplicate findings for the same request/field/kind.

## Common problems and solutions

**Shows “request ... not found”**
- The Request ID doesn’t exist in the current workspace.
- Fix: pick a request in the table and click Use selected.

**Shows “request Content-Type is not application/json”**
- The request is not JSON.
- Fix: pick a different request or ensure you are testing an API, not an HTML page.

**Shows “body is not valid JSON” / “request JSON body must be an object”**
- The body is not JSON or is an array/string instead of an object.
- Fix: use a request whose JSON looks like `{ ... }`.

**No findings**
- This can be normal: the server validates/whitelists input fields.
- Try:
  - a different endpoint (profile/update, settings, checkout, etc.);
  - increasing Max mutations;
  - adding your own Candidate fields;
  - enabling multiple Value modes.

## Testing recommendations

- Proxy traffic through Caido so requests are saved in history.
- Scan only endpoints you are authorized to test.
- Start with a small Max mutations (e.g., 16–32) to avoid unnecessary load.

## AI-Image-Generator-Mass-Assignment-Lab

- You can test the scanner by running my lab: [AI-Image-Generator-Mass-Assignment-Lab](https://github.com/sp1r1tt/AI-Image-Generator-Mass-Assignment-Lab.


## Build and checks

- Linter: `pnpm lint`
- Types: `pnpm typecheck`

## Author: sp1r1t
