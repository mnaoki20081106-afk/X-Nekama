ARCHS = arm64
TARGET := iphone:clang:latest:15.0
INSTALL_TARGET_PROCESSES = Twitter

include $(THEOS)/makefiles/common.mk

TWEAK_NAME = XNekama

XNekama_FILES = Tweak.xm
XNekama_FRAMEWORKS = UIKit Foundation
XNekama_CFLAGS = -fobjc-arc -Wno-deprecated-declarations -Wno-nullability-completeness -Wno-error

include $(THEOS_MAKE_PATH)/tweak.mk
