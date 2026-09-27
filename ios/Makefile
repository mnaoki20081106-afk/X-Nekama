ARCHS = arm64 arm64e
TARGET = iphone:clang:latest:15.0

include $(THEOS)/makefiles/common.mk

LIBRARY_NAME = NekamaBridge

NekamaBridge_FILES = NekamaBridge.m
NekamaBridge_CFLAGS = -fobjc-arc -Wall -Wextra
NekamaBridge_FRAMEWORKS = Foundation UIKit
NekamaBridge_LDFLAGS = -Wl,-install_name,@rpath/NekamaBridge.dylib

include $(THEOS_MAKE_PATH)/library.mk
