# Sol-low operator v5: IPv6 evidence consistency

The v4 gate rejected public `b48deae` / private `722fb5d`: container endpoint
IPv6 addresses could contradict authenticated IPv6-disabled network evidence
without rejection. Private `sol-low-operator-v5/` preserves the relayed finding
and gateway/forwarder regressions failing against v4. All predecessors remain
unchanged.

The shared inspect validator now checks both helpers on both networks. It
requires explicit empty GlobalIPv6Address and IPv6Gateway, numeric zero
GlobalIPv6PrefixLen and null IPAMConfig, matching the archived producer schema.
Missing, malformed, unknown IPv6/link-local fields or IPAM overrides fail closed.
Network-member IPv6Address must likewise be explicitly empty, not merely falsey.
The existing EnableIPv6=false, IPv4 topology and containment checks remain intact.

Fixture defaults are a four-field projection from the authenticated archived
create-only inspect record; freeze reconstruction checks those exact values.
This is not new runtime proof. Tests cover the two gate reproductions, 48
resealed helper/network/field mutations, and missing, unknown and default forms.
The shared runtime-preflight and low-assessor consumers remain covered. No
existing negative assertion is removed or loosened.
Node22 typecheck, 102 prediction, 13 HTTP and 104 affected tests pass.

No provider, Codex client, Docker/image operation or attempt occurred. Accepted
runtime, original low amendment, high inputs and 64 unstarted review slots are
unchanged. Assessment v5 retains default-deny and grants no batch eligibility.
Private validation and byte-identical replay records support this checkpoint;
another independent exact-freeze review is required.
