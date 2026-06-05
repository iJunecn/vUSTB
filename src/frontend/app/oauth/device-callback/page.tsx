'use client';

import { useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

/**
 * Redirect /oauth/device-callback?user_code=XXX → /oauth/device?user_code=XXX
 *
 * Some OAuth clients hard-code the callback path as "device-callback"
 * instead of reading `verification_uri_complete` from the device code response.
 * This page bridges that gap by forwarding to the real device verification page.
 */
export default function DeviceCallbackRedirect() {
  const params = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const userCode = params.get('user_code');
    const target = userCode ? `/oauth/device?user_code=${encodeURIComponent(userCode)}` : '/oauth/device';
    router.replace(target);
  }, [params, router]);

  return null;
}
