ARCHS = arm64
TARGET := iphone:clang:16.5:15.0
INSTALL_TARGET_PROCESSES = Twitter

include $(THEOS)/makefiles/common.mk

TWEAK_NAME = XNekama
XNekama_FILES = Tweak.xm
XNekama_FRAMEWORKS = UIKit Foundation PhotosUI SafariServices
XNekama_CFLAGS = -fobjc-arc -fblocks -Wno-deprecated-declarations -Wno-objc-method-access -Wno-nullability-completeness -Wno-error

include $(THEOS_MAKE_PATH)/tweak.mk
