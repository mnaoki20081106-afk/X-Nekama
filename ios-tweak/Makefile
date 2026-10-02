ARCHS = arm64
TARGET := iphone:clang:16.5:15.0
INSTALL_TARGET_PROCESSES = Twitter

include $(THEOS)/makefiles/common.mk

TWEAK_NAME = XNekama
XNekama_FILES = Tweak.xm Autopilot.mm VPNGate.mm ServerManager.mm NativeGrok.swift
XNekama_FRAMEWORKS = UIKit Foundation PhotosUI SafariServices Network WebKit
XNekama_SWIFTFLAGS = -swift-version 5
XNekama_CFLAGS = -fobjc-arc -fblocks -Wno-deprecated-declarations -Wno-objc-method-access -Wno-nullability-completeness -Wno-error

include $(THEOS_MAKE_PATH)/tweak.mk
