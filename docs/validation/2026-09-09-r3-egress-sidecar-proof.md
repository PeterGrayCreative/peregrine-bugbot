# R3 credential-free egress sidecar proof

Date: 2026-09-09
Implementation commit: `468f75f`
Evidence class: structural/runtime fixture only

## Result

The candidate evaluation image now contains two bounded sidecars and a live
Docker proof of their intended topology:

- a TLS CONNECT gateway restricted to one exact `host:443`, matching TLS SNI,
  public resolved addresses, bounded connections, bytes, requests, and time;
- a tokenized HTTP forwarder restricted to the fixed methodology MCP endpoint
  and fixed upstream, with redirects and unapproved headers denied;
- an IPv4-only internal reviewer network and a separate fixture network, with
  the reviewer connected only to the internal network;
- exact container entrypoint, network, address, alias, mount, environment,
  source-address, challenge, and audit verification before success is reported.

The live probe completed a source read through the MCP forwarder and a pinned
TLS exchange through the gateway. Wrong tokens and mismatched SNI were denied;
direct reviewer connections to both fixture services failed. Sidecar audits
sealed only after teardown.

## Verification

All commands ran under the repository's Node 22 pin.

- Focused gateway, forwarder, probe, and image tests: 46/46 passed.
- Typecheck: passed.
- Native candidate image build and real Docker probe: passed.
- Full `npm run validate`: passed.
  - core tests: 294/294;
  - evidence-capture tests: 13/13;
  - historical-truth tests: 44/44;
  - methodology tests: 168/168;
  - methodology HTTP tests: 13/13;
  - corpus validation, skill/package validation, and structural smoke: passed;
  - structural smoke: 8/8 attempts, 5/5 expected markers.
- Post-probe cleanup found no retained probe containers or networks.
- Two independent reviews reported no P0, P1, or P2 findings after corrections.

The first live probe exposed an invalid test assumption that Docker would add
container-name aliases beyond the explicitly requested aliases. The verifier
was corrected to authenticate only the explicit aliases actually present, and
the rebuilt image and probe then passed.

## Claim boundary

This proof used fake provider and MCP services and no provider credentials. It
does not show that Codex CLI honors proxy configuration, that the historical
methodology runner launches this topology, that a real provider is reachable,
or that model tools work with credentials present. Those require integration
into the trusted provider attachment and a separately authorized
credential-bearing canary. No historical case or model-quality experiment ran.
