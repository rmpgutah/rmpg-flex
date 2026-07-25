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
RMPG_SHELL_DEPENDENCIES = libgtk3 xlib_libX11 host-pkgconf

define RMPG_SHELL_BUILD_CMDS
	$(TARGET_MAKE_ENV) $(MAKE) $(TARGET_CONFIGURE_OPTS) \
		PKG_CONFIG="$(PKG_CONFIG_HOST_BINARY)" -C $(@D)
endef

define RMPG_SHELL_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/rmpg-shell $(TARGET_DIR)/usr/bin/rmpg-shell
endef

$(eval $(generic-package))
