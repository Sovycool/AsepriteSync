import { redirect } from "next/navigation";

// Root → /login
export default function Home() {
  redirect("/login");
}
