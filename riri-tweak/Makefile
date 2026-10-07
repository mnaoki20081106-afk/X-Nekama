ARCHS = arm64
TARGET = iphone:clang:16.5:14.0
include $(THEOS)/makefiles/common.mk
TWEAK_NAME = RiriAutoReply
RiriAutoReply_FILES = RiriAutoReply.xm RiriSetup.m RiriCloudflare.m
RiriAutoReply_CFLAGS = -fobjc-arc -Wno-deprecated-declarations
RiriAutoReply_FRAMEWORKS = Foundation UIKit Security AuthenticationServices
include $(THEOS)/makefiles/tweak.mk
