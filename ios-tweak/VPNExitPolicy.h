#pragma once
#include <string>
#include <sstream>
#include <algorithm>
inline bool NXValidExitConfig(const std::string &ip,const std::string &country) {
    if (country.size()!=2 || country[0]<'A' || country[0]>'Z' || country[1]<'A' || country[1]>'Z') return false;
    std::istringstream stream(ip); std::string part; int count=0,first=-1,second=-1;
    while (std::getline(stream,part,'.')) {
        if (part.empty() || part.size()>3 || (part.size()>1 && part[0]=='0')) return false;
        int n=0; for (char c:part) { if(c<'0'||c>'9')return false; n=n*10+c-'0'; }
        if (n>255 || (count==0 && (n==0||n==127)))return false;
        if(count==0)first=n;if(count==1)second=n;
        ++count;
    }
    return count==4 && !ip.empty() && ip.back()!='.' && first!=10 && first<224 && !(first==169&&second==254) && !(first==172&&second>=16&&second<=31) && !(first==192&&second==168) && !(first==100&&second>=64&&second<=127);
}
inline bool NXExitProof(std::string trace,bool shared,const std::string &expectedIP,const std::string &country) {
    if (trace.size()>65536) return false;
    trace.erase(std::remove(trace.begin(),trace.end(),'\r'),trace.end());
    std::istringstream stream(trace); std::string line,ip,loc,warp; bool haveIP=false,haveLoc=false,haveWarp=false;
    while(std::getline(stream,line)) {
        auto at=line.find('='); if(at==std::string::npos)continue;
        auto key=line.substr(0,at),value=line.substr(at+1);
        if(key=="ip"){if(haveIP)return false;haveIP=true;ip=value;}
        if(key=="loc"){if(haveLoc)return false;haveLoc=true;loc=value;}
        if(key=="warp"){if(haveWarp)return false;haveWarp=true;warp=value;}
    }
    return shared?NXValidExitConfig(expectedIP,country)&&haveIP&&haveLoc&&ip==expectedIP&&loc==country:warp=="on"||warp=="plus";
}
