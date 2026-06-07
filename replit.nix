# Nix environment for Live Breach on Replit.
# Node 22+ is required because the real SQL-injection target uses the built-in
# node:sqlite module (added in Node 22).
{ pkgs }: {
  deps = [
    pkgs.nodejs_22
  ];
}
