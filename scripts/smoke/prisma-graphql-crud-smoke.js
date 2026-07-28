const BASE_URL = process.env.PRISMA_SMOKE_BASE_URL || "http://localhost:4000";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function firstCookie(response) {
  const setCookie = response.headers.get("set-cookie") || "";
  return setCookie.split(";")[0];
}

async function requestGraphQL(query, variables, cookies, csrfToken) {
  const response = await fetch(`${BASE_URL}/graphql`, {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
      Cookie: cookies,
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();

  if (!response.ok || payload.errors) {
    throw new Error(`GraphQL request failed: ${JSON.stringify(payload)}`);
  }

  return payload.data;
}

async function main() {
  const csrfResponse = await fetch(`${BASE_URL}/auth/csrf`, {
    headers: { Origin: "http://localhost:3000" },
  });
  const csrfPayload = await csrfResponse.json();
  const csrfCookie = firstCookie(csrfResponse);
  const csrfToken = csrfPayload.csrfToken;
  assert(csrfResponse.ok && csrfToken && csrfCookie, "CSRF bootstrap failed");

  const guestResponse = await fetch(`${BASE_URL}/auth/guest-session`, {
    method: "POST",
    headers: {
      Origin: "http://localhost:3000",
      "X-CSRF-Token": csrfToken,
      Cookie: csrfCookie,
    },
  });
  const guestCookie = firstCookie(guestResponse);
  assert(guestResponse.ok && guestCookie, "Guest session bootstrap failed");

  const cookies = `${csrfCookie}; ${guestCookie}`;
  const boardData = await requestGraphQL(
    "mutation($name: String!) { createBoard(name: $name) { id } }",
    { name: `Prisma CRUD Smoke ${Date.now()}` },
    cookies,
    csrfToken
  );
  const boardId = boardData.createBoard.id;
  const createdData = await requestGraphQL(
    "mutation($boardId: ID!) { createNote(boardId: $boardId, title: \"Prisma note\", content: \"Initial content for Prisma CRUD\") { id boardId embeddingPending } }",
    { boardId },
    cookies,
    csrfToken
  );
  const noteId = createdData.createNote.id;
  const updatedData = await requestGraphQL(
    "mutation($boardId: ID!, $id: ID!) { updateNote(boardId: $boardId, id: $id, content: \"Updated content for Prisma CRUD\") { id content embeddingPending } }",
    { boardId, id: noteId },
    cookies,
    csrfToken
  );
  let semanticMatches = null;

  if (!updatedData.updateNote.embeddingPending) {
    const semanticData = await requestGraphQL(
      "query($boardId: ID!) { semanticSearch(boardId: $boardId, query: \"Updated content for Prisma CRUD\") { id semanticScore } }",
      { boardId },
      cookies,
      csrfToken
    );
    semanticMatches = semanticData.semanticSearch.length;
    assert(
      semanticData.semanticSearch.some((note) => note.id === noteId),
      "semanticSearch did not return the updated note"
    );
  }

  const listedData = await requestGraphQL(
    "query($boardId: ID!) { listNotes(boardId: $boardId) { id content embeddingPending } }",
    { boardId },
    cookies,
    csrfToken
  );
  const deletedData = await requestGraphQL(
    "mutation($boardId: ID!, $id: ID!) { deleteNote(boardId: $boardId, id: $id) }",
    { boardId, id: noteId },
    cookies,
    csrfToken
  );
  const boardDeletedData = await requestGraphQL(
    "mutation($id: ID!) { deleteBoard(id: $id) }",
    { id: boardId },
    cookies,
    csrfToken
  );

  assert(listedData.listNotes.length === 1, "listNotes did not return the created note");
  assert(
    updatedData.updateNote.content === "Updated content for Prisma CRUD",
    "updateNote did not persist content"
  );
  assert(deletedData.deleteNote === true, "deleteNote did not delete the note");
  assert(boardDeletedData.deleteBoard === true, "deleteBoard did not delete the board");

  console.log(
    JSON.stringify(
      {
        boardId,
        noteId,
        embeddingPending: updatedData.updateNote.embeddingPending,
        semanticMatches,
        listed: listedData.listNotes.length,
        deleted: deletedData.deleteNote,
        boardDeleted: boardDeletedData.deleteBoard,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Prisma GraphQL CRUD smoke failed:");
  console.error(error);
  process.exit(1);
});