import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      {/* Theme toggle — top-right corner */}
      <div className="fixed top-4 right-4">
        <ThemeToggle />
      </div>

      {/* Brand */}
      <div className="mb-8 flex flex-col items-center gap-2">
        <span className="text-2xl font-bold tracking-tight">AsepriteSync</span>
        <span className="text-sm text-muted-foreground">Collaborative pixel-art asset management</span>
      </div>

      {/* Page card */}
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
