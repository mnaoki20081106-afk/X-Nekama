#include "../VPNPolicy.h"
#include "../VPNExitPolicy.h"
#include <cassert>
#include <iostream>
int main() {
    assert(NXExitProof("ip=203.0.113.8\nloc=JP\nwarp=off\n",true,"203.0.113.8","JP"));
    assert(!NXExitProof("ip=203.0.113.9\nloc=JP\nwarp=off\n",true,"203.0.113.8","JP"));
    assert(!NXExitProof("ip=203.0.113.8\nloc=US\nwarp=off\n",true,"203.0.113.8","JP"));
    assert(!NXExitProof("ip=203.0.113.8\nip=203.0.113.9\nloc=JP\n",true,"203.0.113.8","JP"));
    assert(!NXExitProof("warp=on\n",true,"","JP"));
    assert(NXExitProof("warp=on\n",false,"",""));
    assert(!NXExitProof("warp=off\n",false,"",""));
    assert(!NXValidExitConfig("203.0.113.8.","JP"));
    NXVPNPolicy p;
    assert(!p.ready(10,true)); // Cold start.
    p.invalidate(true); auto request=p.epoch;
    assert(!p.ready(10,true)); // Active but unverified.
    p.result(request,true,10);
    assert(p.ready(10,true) && p.ready(13.99,true));
    assert(!p.ready(14,true) && !p.ready(9,true)); // Expiry and invalid clock.
    assert(!p.ready(11,false)); // Tunnel loss even with fresh proof.
    p.result(request,false,11); assert(!p.ready(11,true));
    p.result(request,true,12); p.invalidate(false);
    p.result(request,true,13); assert(!p.ready(13,true)); // In-flight background result.
    p.invalidate(true); auto next=p.epoch;
    p.result(request,true,14); assert(!p.ready(14,true)); // Stale foreground response.
    p.result(next,true,15); assert(p.ready(15,true));
    p.invalidate(true); p.result(next,true,16); assert(!p.ready(16,true)); // Path change.
    std::cout << "VPN fail-closed policy checks passed\n";
}
