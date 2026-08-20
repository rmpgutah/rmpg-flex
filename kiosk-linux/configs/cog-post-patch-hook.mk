# kiosk-linux/configs/cog-post-patch-hook.mk
# Appended to Buildroot package/cog/cog.mk by build.sh.
#
# Enforces the 0005 user_data fix at EVERY call site. The two functions that
# create a buffer_object end in IDENTICAL 5-line blocks, and GNU patch (run by
# Buildroot with -t) silently treats the second occurrence as already-applied
# and skips it -- observed across three real rebuilds, each leaving the
# shm-buffer create path still hijacking libwayland own user_data slot and
# segfaulting the moment a real page destroyed a buffer. This hook rewrites
# every remaining call site after patching and FAILS THE BUILD if any survive,
# rather than shipping a half-patched renderer.
define COG_FIX_SHM_USER_DATA
	$(SED) "s|    wl_resource_set_user_data(buffer_resource, self);|    buffer->renderer = self;|" $(@D)/platform/drm/cog-drm-modeset-renderer.c
	if grep -q "wl_resource_set_user_data(buffer_resource, self)" $(@D)/platform/drm/cog-drm-modeset-renderer.c; then \
		echo "ERROR: cog user_data hijack still present after post-patch fixup" >&2; \
		exit 1; \
	fi
endef
COG_POST_PATCH_HOOKS += COG_FIX_SHM_USER_DATA
