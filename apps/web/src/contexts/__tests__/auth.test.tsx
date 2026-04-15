import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "../auth";
import * as api from "@/lib/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockUser = {
  id: "user-1",
  email: "test@example.com",
  username: "testuser",
  avatarUrl: null,
};

const mockLoginResult = {
  accessToken: "access-token-abc",
  user: mockUser,
};

function Probe() {
  const { user, accessToken, loading } = useAuth();
  if (loading) return <span data-testid="loading" />;
  return (
    <>
      <span data-testid="user">{user?.username ?? "none"}</span>
      <span data-testid="token">{accessToken ?? "none"}</span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("AuthProvider — session restore", () => {
  it("shows loading spinner while refresh is in flight", () => {
    vi.spyOn(api.authApi, "refresh").mockReturnValue(new Promise(() => {})); // never resolves
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId("loading")).toBeInTheDocument();
  });

  it("restores user and token when refresh succeeds", async () => {
    vi.spyOn(api.authApi, "refresh").mockResolvedValue(mockLoginResult);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("user")).toBeInTheDocument());
    expect(screen.getByTestId("user").textContent).toBe("testuser");
    expect(screen.getByTestId("token").textContent).toBe("access-token-abc");
  });

  it("sets user to null when refresh fails", async () => {
    vi.spyOn(api.authApi, "refresh").mockRejectedValue(new Error("expired"));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("user")).toBeInTheDocument());
    expect(screen.getByTestId("user").textContent).toBe("none");
    expect(screen.getByTestId("token").textContent).toBe("none");
  });
});

describe("AuthProvider — login", () => {
  it("sets user and token after successful login", async () => {
    vi.spyOn(api.authApi, "refresh").mockRejectedValue(new Error("no session"));
    vi.spyOn(api.authApi, "login").mockResolvedValue(mockLoginResult);

    function LoginButton() {
      const { login } = useAuth();
      return <button onClick={() => void login("test@example.com", "password")}>Login</button>;
    }

    render(
      <AuthProvider>
        <Probe />
        <LoginButton />
      </AuthProvider>,
    );

    // Wait for initial refresh to fail
    await waitFor(() => expect(screen.getByTestId("user")).toBeInTheDocument());
    expect(screen.getByTestId("user").textContent).toBe("none");

    await act(async () => {
      screen.getByText("Login").click();
    });

    await waitFor(() =>
      expect(screen.getByTestId("user").textContent).toBe("testuser"),
    );
    expect(screen.getByTestId("token").textContent).toBe("access-token-abc");
  });
});

describe("AuthProvider — logout", () => {
  it("clears user and token after logout", async () => {
    vi.spyOn(api.authApi, "refresh").mockResolvedValue(mockLoginResult);
    vi.spyOn(api.authApi, "logout").mockResolvedValue(undefined);

    function LogoutButton() {
      const { logout } = useAuth();
      return <button onClick={() => void logout()}>Logout</button>;
    }

    render(
      <AuthProvider>
        <Probe />
        <LogoutButton />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("user").textContent).toBe("testuser"),
    );

    await act(async () => {
      screen.getByText("Logout").click();
    });

    expect(screen.getByTestId("user").textContent).toBe("none");
    expect(screen.getByTestId("token").textContent).toBe("none");
  });
});
