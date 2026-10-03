#pragma once
// Monotonic timestamps; foreground and path epochs invalidate pending probes.
struct NXVPNPolicy {
    bool active = false;
    double verified = -1;
    unsigned long epoch = 0;
    void invalidate(bool foreground) { active = foreground; verified = -1; ++epoch; }
    bool ready(double now, bool tunnel) const {
        return active && tunnel && verified >= 0 && now >= verified && now - verified < 4.0;
    }
    void result(unsigned long requestEpoch, bool success, double now) {
        if (active && requestEpoch == epoch) verified = success ? now : -1;
    }
};
