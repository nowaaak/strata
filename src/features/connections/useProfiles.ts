import { useQuery } from "@tanstack/react-query";
import { listProfiles } from "@/api/profiles";
import type { ConnectionProfile } from "@/bindings/ConnectionProfile";

export const profilesKey = ["profiles"] as const;

export function useProfiles() {
    return useQuery({ queryKey: profilesKey, queryFn: listProfiles, staleTime: Infinity });
}

export function useProfile(profileId: string | undefined): ConnectionProfile | undefined {
    return useProfiles().data?.find((profile) => profile.id === profileId);
}
