import { useId } from "react";

export function StrataLogo({ size = 24, className }: { size?: number; className?: string }) {
    const id = useId();
    const sky = `${id}-sky`;
    const middle = `${id}-middle`;
    const bottom = `${id}-bottom`;

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            className={className}
            role="img"
            aria-label="Strata"
        >
            <defs>
                <linearGradient id={sky} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#2a2f7a" />
                    <stop offset="1" stopColor="#0a0d24" />
                </linearGradient>
                <linearGradient id={middle} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor="#a5b4fc" />
                    <stop offset="1" stopColor="#6366f1" />
                </linearGradient>
                <linearGradient id={bottom} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor="#67e8f9" />
                    <stop offset="1" stopColor="#0891b2" />
                </linearGradient>
            </defs>
            <rect width="32" height="32" rx="8" fill={`url(#${sky})`} />
            <path d="M6 9.2Q16 6.2 26 9.2V12.4Q16 9.4 6 12.4Z" fill="#e0e7ff" />
            <path d="M6 15.4Q16 12.4 26 15.4V18.6Q16 15.6 6 18.6Z" fill={`url(#${middle})`} />
            <path d="M6 21.6Q16 18.6 26 21.6V24.8Q16 21.8 6 24.8Z" fill={`url(#${bottom})`} />
        </svg>
    );
}
