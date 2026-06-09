"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { LoginPage } from "@/components/LoginPage";
import { loginAction } from "./actions";

function LoginInner() {
  const params = useSearchParams();

  // Surface error reasons that middleware / the (app) layout encoded in the URL.
  useEffect(() => {
    const err = params.get("error");
    if (err === "no_profile") toast.error("Your account has no profile yet. Contact your Super Admin.");
    else if (err === "inactive") toast.error("Your account is inactive.");
  }, [params]);

  const handleCredentialsSubmit = async (email: string, password: string) => {
    const redirectTo = params.get("redirect") ?? undefined;
    const result = await loginAction({ email, password, redirectTo });
    // On success the server action calls redirect() and this line never runs.
    if (result?.error) toast.error(result.error);
  };

  return <LoginPage onSubmitCredentials={handleCredentialsSubmit} />;
}

// Next requires useSearchParams() consumers to be wrapped in <Suspense> so the
// surrounding shell can be statically pre-rendered. The fallback is a brief blank
// since the login UI itself paints near-instantly.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
