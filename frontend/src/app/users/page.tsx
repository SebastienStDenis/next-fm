import Link from "next/link";

import { CreateUserForm } from "./create-user-form";

type User = {
  id: string;
  name: string;
};

const apiUrl = process.env.API_URL ?? "http://localhost:8000";

export default async function UsersPage() {
  const res = await fetch(`${apiUrl}/users`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load users: ${res.status}`);
  }
  const users: User[] = await res.json();

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="mb-4 text-2xl font-semibold">Users</h1>
      <CreateUserForm />
      {users.length === 0 ? (
        <p className="text-sm text-gray-500">No users yet.</p>
      ) : (
        <ul className="space-y-2">
          {users.map((user) => (
            <li key={user.id}>
              <Link
                href={`/users/${user.id}`}
                className="block rounded border border-gray-300 px-4 py-2 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-900"
              >
                <span className="text-gray-500">#{user.id}</span> {user.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
