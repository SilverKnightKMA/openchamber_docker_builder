//go:build tools

package tools

import (
	_ "golang.org/x/tools/gopls"
	_ "mvdan.cc/sh/v3/cmd/shfmt"
)
