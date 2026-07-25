# kiosk-linux/rmpg-shell/Makefile
# Builds the two first-party desktop components:
#   rmpg-shell   — taskbar, Start menu, status indicators, Wi-Fi picker
#   rmpg-browser — tabbed web browser on WebKitGTK
#
# Built by Buildroot's generic-package infrastructure (see
# buildroot-package/rmpg-shell.mk), which passes CC/CFLAGS/LDFLAGS for the
# cross toolchain — so never hardcode a compiler here.
#
# pkg-config is invoked through $(PKG_CONFIG) rather than the bare binary:
# Buildroot supplies a target-aware wrapper, and calling the host pkg-config
# would resolve host headers and produce a binary linked against the build
# machine instead of the target sysroot.
PKG_CONFIG ?= pkg-config
CC         ?= gcc
CFLAGS     ?= -O2
PREFIX     ?= /usr

SHELL_CFLAGS := $(shell $(PKG_CONFIG) --cflags gtk+-3.0 x11)
SHELL_LIBS   := $(shell $(PKG_CONFIG) --libs   gtk+-3.0 x11)

# webkit2gtk-4.1 is what Buildroot's webkitgtk provides; 4.0 is the older
# soup2-based ABI. Probe for 4.1 and fall back, so this Makefile keeps working
# if the package is ever bumped to a different soup generation.
WEBKIT_PC := $(shell $(PKG_CONFIG) --exists webkit2gtk-4.1 && echo webkit2gtk-4.1 || echo webkit2gtk-4.0)
BROWSER_CFLAGS := $(shell $(PKG_CONFIG) --cflags gtk+-3.0 $(WEBKIT_PC))
BROWSER_LIBS   := $(shell $(PKG_CONFIG) --libs   gtk+-3.0 $(WEBKIT_PC))

# Fail loudly when the webkit module is missing. pkg-config returns NOTHING on
# an unknown module, so without this check the compile proceeds with empty
# CFLAGS and dies on "gtk/gtk.h: No such file or directory" — an error that
# points at GTK when the real problem is webkitgtk being absent or not built
# yet (which happened for real: rmpg-shell.mk was missing its webkitgtk
# dependency, so this package was built first).
ifeq ($(strip $(BROWSER_CFLAGS)),)
$(error webkit2gtk pkg-config module not found ($(WEBKIT_PC)). \
  Is BR2_PACKAGE_WEBKITGTK enabled, and is webkitgtk listed in \
  RMPG_SHELL_DEPENDENCIES so it builds first?)
endif

WARNINGS = -Wall -Wextra

all: rmpg-shell rmpg-browser

rmpg-shell: rmpg-shell.c
	$(CC) $(CFLAGS) $(WARNINGS) $(SHELL_CFLAGS) -o $@ $< $(LDFLAGS) $(SHELL_LIBS)

rmpg-browser: rmpg-browser.c
	$(CC) $(CFLAGS) $(WARNINGS) $(BROWSER_CFLAGS) -o $@ $< $(LDFLAGS) $(BROWSER_LIBS)

install: all
	install -D -m 0755 rmpg-shell   $(DESTDIR)$(PREFIX)/bin/rmpg-shell
	install -D -m 0755 rmpg-browser $(DESTDIR)$(PREFIX)/bin/rmpg-browser

clean:
	rm -f rmpg-shell rmpg-browser

.PHONY: all install clean
