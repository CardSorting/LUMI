# IMPORTANT: `npm run postpublish` to update this file after publishing a new version of the package
class Codemarie < Formula
  desc "Autonomous coding agent CLI - capable of creating/editing files, running commands, and more"
  homepage "https://codemarie.bot"
  url "https://registry.npmjs.org/codemarie-cli/-/codemarie-cli-2.5.1.tgz" # GET from https://registry.npmjs.org/codemarie-cli/latest tarball URL
  sha256 "65bae90401191aeeabfbbc0b315e816aea96742043ba85b90671bf5e19d0761e"
  license "Apache-2.0"

  depends_on "node@20"
  depends_on "ripgrep"

  def install
    system "npm", "install", *std_npm_args(prefix: false)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    # Test that the binary exists and is executable
    assert_match version.to_s, shell_output("#{bin}/codemarie --version")
  end
end
