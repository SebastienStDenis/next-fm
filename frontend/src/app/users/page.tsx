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
      <ul className="space-y-2">
        {users.map((user) => (
          <li
            key={user.id}
            className="rounded border border-gray-300 px-4 py-2 dark:border-gray-700"
          >
            <span className="text-gray-500">#{user.id}</span> {user.name}
          </li>
        ))}
      </ul>
    </main>
  );
}
