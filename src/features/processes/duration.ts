export function formatDuration(seconds: number | null): string {
    if (seconds === null) {
        return "";
    }
    if (seconds < 60) {
        return `${seconds} s`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        const rest = seconds % 60;
        return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
    }
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    if (hours < 24) {
        return restMinutes === 0 ? `${hours} h` : `${hours} h ${restMinutes} min`;
    }
    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return restHours === 0 ? `${days} d` : `${days} d ${restHours} h`;
}
