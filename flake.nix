{
  description = "Dev environment for strato-db";

  inputs = {
    # Make sure to use the same locked commits as the nix-infra deploys
    # That way the packages are shared
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      b = builtins;
      # Make sure that this include runtime libs linked by npm builds
      deps = pkgs: with pkgs; [
        bashInteractive
        sqlite-interactive
        # NodeJS
        nodejs_22
        corepack_22
      ];
      makeDevShell = system: pkgs: {
        default = pkgs.mkShell {
          nativeBuildInputs = (deps pkgs) ++ (with pkgs; [
            gitMinimal

            # sqlite3 module
            sqlite-interactive.dev
          ]);
          shellHook = ''
            export PATH=$PWD/node_modules/.bin:$PATH
          '';
        };
      };
    in
    {
      devShells = b.mapAttrs (makeDevShell) nixpkgs.legacyPackages;
    };
}
