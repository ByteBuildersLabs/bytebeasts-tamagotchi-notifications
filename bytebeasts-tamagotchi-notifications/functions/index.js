const { onSchedule } = require("firebase-functions/v2/scheduler");
const functions = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
// const { getFirestore } = require("firebase-admin/firestore");
const { ApolloClient, InMemoryCache, gql } = require("@apollo/client/core");
const fetch = require("cross-fetch");

// Initialize Firebase Admin SDK
const app = initializeApp();

// Configure Firestore to use the emulator if running locally
// const firestore = getFirestore(app);
// if (process.env.FUNCTIONS_EMULATOR) {
//   firestore.settings({
//     host: "localhost:8080",
//     ssl: false,
//   });
// }

// Configure Apollo Client to query the Torii GraphQL API
const client = new ApolloClient({
  uri: "https://api.cartridge.gg/x/achievbb/torii/graphql",
  cache: new InMemoryCache(),
  fetch,
});

// GraphQL Query with pagination
const GET_BEAST_AND_TOKEN_DATA = gql`
  query GetBeastAndTokenData($beastStatusAfter: String, $beastAfter: String, $tokenAfter: String) {
    tamagotchiBeastStatusModels(first: 100, after: $beastStatusAfter) {
      edges {
        node {
          beast_id
          is_alive
          is_awake
          hunger
          energy
          happiness
          hygiene
          clean_status
          last_timestamp
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
    tamagotchiBeastModels(first: 100, after: $beastAfter) {
      edges {
        node {
          beast_id
          player
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
    tamagotchiPushTokenModels(first: 100, after: $tokenAfter) {
      edges {
        node {
          player_address
          token
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`;

console.log("Running...");

// Hardcoded flag and token for testing
const TEST_MODE = false;
const TEST_FCM_TOKEN = "fAU1e5l3h3LH3IvL-oopuG:APA91bEyIf3TgVqh-bNBVP3-lsH0Sav-BCQ1pHn017DNjC8D6ZAIy5Bg36bz5KjwGBje00HRYqE8lBwb1SrqfzaVeistcA1M5VYJJEdNwPbNazRrwfg2Ieo";

exports.checkBeast = onSchedule(
  { schedule: "every 1 minutes", region: "us-central1" },
  async (context) => {
    try {
      // If in test mode, send a default notification and exit
      if (TEST_MODE) {
        const payload = {
          notification: {
            title: "🔔 Test Notificacion",
            body: "Check your beast.",
          },
          token: TEST_FCM_TOKEN,
        };

        await getMessaging().send(payload);
        console.log("Test notification sent to hardcoded FCM token.");
        return null;
      }

      // Fetch all data with pagination
      let beastStatuses = [];
      let beastPlayers = [];
      let pushTokens = [];

      // Fetch TamagotchiBeastStatusModels
      let beastStatusAfter = null;
      let hasNextBeastStatusPage = true;
      while (hasNextBeastStatusPage) {
        const { data } = await client.query({
          query: GET_BEAST_AND_TOKEN_DATA,
          variables: { beastStatusAfter, beastAfter: null, tokenAfter: null },
        });
        const batch = data.tamagotchiBeastStatusModels.edges.map((edge) => edge.node);
        beastStatuses = beastStatuses.concat(batch);
        beastStatusAfter = data.tamagotchiBeastStatusModels.pageInfo.endCursor;
        hasNextBeastStatusPage = data.tamagotchiBeastStatusModels.pageInfo.hasNextPage;
      }
      console.log("Fetched TamagotchiBeastStatusModels:", beastStatuses);

      // Fetch TamagotchiBeastModels
      let beastAfter = null;
      let hasNextBeastPage = true;
      while (hasNextBeastPage) {
        const { data } = await client.query({
          query: GET_BEAST_AND_TOKEN_DATA,
          variables: { beastStatusAfter: null, beastAfter, tokenAfter: null },
        });
        const batch = data.tamagotchiBeastModels.edges.map((edge) => edge.node);
        beastPlayers = beastPlayers.concat(batch);
        beastAfter = data.tamagotchiBeastModels.pageInfo.endCursor;
        hasNextBeastPage = data.tamagotchiBeastModels.pageInfo.hasNextPage;
      }
      console.log("Fetched TamagotchiBeastModels:", beastPlayers);

      // Fetch TamagotchiPushTokenModels
      let tokenAfter = null;
      let hasNextTokenPage = true;
      while (hasNextTokenPage) {
        const { data } = await client.query({
          query: GET_BEAST_AND_TOKEN_DATA,
          variables: { beastStatusAfter: null, beastAfter: null, tokenAfter },
        });
        const batch = data.tamagotchiPushTokenModels.edges.map((edge) => edge.node);
        pushTokens = pushTokens.concat(batch);
        tokenAfter = data.tamagotchiPushTokenModels.pageInfo.endCursor;
        hasNextTokenPage = data.tamagotchiPushTokenModels.pageInfo.hasNextPage;
      }
      console.log("Fetched TamagotchiPushTokenModels:", pushTokens);

      // Analyze beast status and send notifications
      for (const beast of beastStatuses) {
        const {
          beast_id,
          hunger,
          energy,
          happiness,
          hygiene,
          is_alive,
        } = beast;

        // Find the player's address using beast_id
        const player = beastPlayers.find(
          (bp) => bp.beast_id === beast_id
        )?.player;

        if (!player) {
          console.log(
            `No player address found for beast_id: ${beast_id}`
          );
          continue;
        }

        // Find the player's FCM token using player_address
        const playerToken = pushTokens.find(
          (token) => token.player_address === player
        )?.token;

        if (!playerToken) {
          console.log(
            `No FCM token found for player_address: ${player} (beast_id: ${beast_id})`
          );
          continue;
        }

        // Check cooldown in Firestore (commented out)
        // let lastNotifiedTime = 0;
        // try {
        //   const lastNotifiedDoc = await getFirestore()
        //     .collection("lastNotified")
        //     .doc(player)
        //     .get();
        //   lastNotifiedTime = lastNotifiedDoc.exists
        //     ? lastNotifiedDoc.data().timestamp || 0
        //     : 0;
        // } catch (firestoreError) {
        //   console.error(`Error reading lastNotified for player ${player}:`, firestoreError);
        //   continue;
        // }

        const now = Date.now();
        // const cooldown = 60 * 60 * 1000; // 1 hour cooldown
        // if (now - lastNotifiedTime < cooldown) {
        //   console.log(`Skipping notification for ${player} due to cooldown`);
        //   continue;
        // }

        // Define notification rules
        const messages = [];

        if (!is_alive) {
          messages.push({
            title: "💔 Your Beast Needs Help!",
            body: "Oh no! Your beast has fainted. Revive it now! 🏥",
          });
        } else {
          if (hunger < 90) {
            messages.push({
              title: "🍽️ Your Beast is Hungry!",
              body: `Your beast's hunger is low (${hunger}/100). Feed it now! 🥐`,
            });
          }
          if (energy < 90) {
            messages.push({
              title: "⚡ Your Beast is Tired!",
              body: `Your beast's energy is low (${energy}/100). Let it rest! 💤`,
            });
          }
          if (happiness < 90) {
            messages.push({
              title: "😢 Your Beast is Sad!",
              body: `Your beast's happiness is low (${happiness}/100). Play with it! 🎉`,
            });
          }
          if (hygiene < 90) {
            messages.push({
              title: "🛁 Your Beast Needs a Bath!",
              body: `Your beast's hygiene is low (${hygiene}/100). Clean it up! 🧼`,
            });
          }
        }

        // Send notifications if there are any messages
        for (const message of messages) {
          const payload = {
            notification: {
              title: message.title,
              body: message.body,
            },
            token: playerToken,
          };

          await getMessaging().send(payload);
          console.log(
            `Notification sent for beast_id: ${beast_id} (player_address: ${player})`,
            message
          );

          // Update last notified time in Firestore (commented out)
          // try {
          //   await getFirestore()
          //     .collection("lastNotified")
          //     .doc(player)
          //     .set({
          //       timestamp: now,
          //     });
          // } catch (firestoreError) {
          //   console.error(`Error updating lastNotified for player ${player}:`, firestoreError);
          // }
        }
      }

      return null;
    } catch (error) {
      console.error("Error in checkBeastStatus:", error);
      throw new Error("Error in scheduled function");
    }
  }
);