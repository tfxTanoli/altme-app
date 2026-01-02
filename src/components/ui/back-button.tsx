'use client';

import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function BackButton({ className }: { className?: string }) {
    const router = useRouter();

    return (
        <Button
            variant="ghost"
            size="sm"
            className={className}
            onClick={() => router.back()}
        >
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back
        </Button>
    );
}
