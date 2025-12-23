import { useEffect } from "react";
import { supabase } from "./supabaseClient";

export default function AuthCallback() {
  useEffect(() => {
    (async () => {
      // يمسك السيشن من الـ URL
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Auth callback error:", error);
      }

      // يرجعك للهوم
      window.location.replace("/");
    })();
  }, []);

  return (
    <div style={{ color: "#fff", padding: 24 }}>
      Signing you in...
    </div>
  );
}
