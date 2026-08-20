################################################################################
#
# rmpg-shell
#
# Built from the in-repo source at kiosk-linux/rmpg-shell, which build.sh
# bind-mounts into the container at /kiosk-linux. SITE_METHOD = local copies
# that tree into the build directory, so edits to rmpg-shell.c are picked up by
# a plain `make rmpg-shell-rebuild` with no tarball or version bump.
#
################################################################################

RMPG_SHELL_VERSION = 1.0.0
RMPG_SHELL_SITE = /kiosk-linux/rmpg-shell
RMPG_SHELL_SITE_METHOD = local
RMPG_SHELL_LICENSE = Proprietary

# webkitgtk is a HARD dependency, not an optional one: rmpg-browser includes
# gtk/gtk.h through the webkit2gtk pkg-config module. Omitting it here let
# Buildroot schedule this package BEFORE webkitgtk, so webkit2gtk-4.1.pc was
# not in the sysroot yet, the pkg-config probe in the Makefile returned
# nothing, and the compile died on "gtk/gtk.h: No such file or directory" —
# a missing-header error whose real cause was build ORDER, not a missing GTK
# (rmpg-shell, which needs the same header, had just compiled fine).
# xlib_libXScrnSaver is dlopen'd at RUNTIME by the idle-lock watcher, not linked,
# so nothing here would otherwise force it to be built before this package. It
# must still be listed: without it the shell starts fine and silently runs with
# NO IDLE LOCK, which on a terminal displaying dispatch data is a security
# regression that looks like nothing at all.
RMPG_SHELL_DEPENDENCIES = libgtk3 webkitgtk xlib_libX11 xlib_libXScrnSaver host-pkgconf

define RMPG_SHELL_BUILD_CMDS
	$(TARGET_MAKE_ENV) $(MAKE) $(TARGET_CONFIGURE_OPTS) \
		PKG_CONFIG="$(PKG_CONFIG_HOST_BINARY)" -C $(@D)
endef

define RMPG_SHELL_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/rmpg-shell $(TARGET_DIR)/usr/bin/rmpg-shell
	$(INSTALL) -D -m 0755 $(@D)/rmpg-browser $(TARGET_DIR)/usr/bin/rmpg-browser
	$(INSTALL) -D -m 0755 $(@D)/rmpg-lock    $(TARGET_DIR)/usr/bin/rmpg-lock
endef

$(eval $(generic-package))
