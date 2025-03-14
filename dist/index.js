// src/actions/post.ts
import {
  composeContext,
  elizaLogger,
  ModelClass,
  generateObject,
  messageCompletionFooter,
  truncateToCompleteSentence
} from "@elizaos/core";
import { Scraper } from "agent-twitter-client";

// src/templates.ts
var tweetTemplate = `
# Context
{{recentMessages}}

# Topics
{{topics}}

# Post Directions
{{postDirections}}

# Recent interactions between {{agentName}} and other users:
{{recentPostInteractions}}

# Task
Generate a tweet that:
1. Relates to the recent conversation or requested topic
2. Matches the character's style and voice
3. Is concise and engaging
4. Must be UNDER 180 characters (this is a strict requirement)
5. Speaks from the perspective of {{agentName}}

Generate only the tweet text, no other commentary.

Return the tweet in JSON format like: {"text": "your tweet here"}`;

// src/types.ts
import { z } from "zod";
var TweetSchema = z.object({
  text: z.string().describe("The text of the tweet")
});
var isTweetContent = (obj) => {
  return TweetSchema.safeParse(obj).success;
};

// src/actions/post.ts
var DEFAULT_MAX_TWEET_LENGTH = 280;
async function composeTweet(runtime, _message, state) {
  try {
    const context = composeContext({
      state,
      template: tweetTemplate + `
${messageCompletionFooter}`
    });
    const tweetContentObject = await generateObject({
      runtime,
      context,
      modelClass: ModelClass.SMALL,
      schema: TweetSchema,
      stop: ["\n"]
    });
    if (!isTweetContent(tweetContentObject.object)) {
      elizaLogger.error(
        "Invalid tweet content:",
        tweetContentObject.object
      );
      return;
    }
    let trimmedContent = tweetContentObject.object.text.trim();
    const maxTweetLength = runtime.getSetting("MAX_TWEET_LENGTH");
    if (maxTweetLength) {
      trimmedContent = truncateToCompleteSentence(
        trimmedContent,
        Number(maxTweetLength)
      );
    }
    return trimmedContent;
  } catch (error) {
    elizaLogger.error("Error composing tweet:", error);
    throw error;
  }
}
async function sendTweet(twitterClient, content) {
  var _a, _b, _c;
  const result = await twitterClient.sendTweet(content);
  const body = await result.json();
  elizaLogger.log("Tweet response:", body);
  if (body.errors) {
    const error = body.errors[0];
    elizaLogger.error(
      `Twitter API error (${error.code}): ${error.message}`
    );
    return null;
  }
  if (!((_c = (_b = (_a = body == null ? void 0 : body.data) == null ? void 0 : _a.create_tweet) == null ? void 0 : _b.tweet_results) == null ? void 0 : _c.result)) {
    elizaLogger.error("Failed to post tweet: No tweet result in response");
    return null;
  }
  return body;
}
async function postTweet(runtime, content) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n;
  try {
    const twitterClient = (_b = (_a = runtime.clients.twitter) == null ? void 0 : _a.client) == null ? void 0 : _b.twitterClient;
    const scraper = twitterClient || new Scraper();
    if (!twitterClient) {
      const username = runtime.getSetting("TWITTER_USERNAME");
      const password = runtime.getSetting("TWITTER_PASSWORD");
      const email = runtime.getSetting("TWITTER_EMAIL");
      const twitter2faSecret = runtime.getSetting("TWITTER_2FA_SECRET");
      if (!username || !password) {
        elizaLogger.error(
          "Twitter credentials not configured in environment"
        );
        return null;
      }
      await scraper.login(username, password, email, twitter2faSecret);
      if (!await scraper.isLoggedIn()) {
        elizaLogger.error("Failed to login to Twitter");
        return null;
      }
    }
    elizaLogger.log("Attempting to send tweet:", content);
    try {
      let res = null;
      if (content.length > DEFAULT_MAX_TWEET_LENGTH) {
        res = await scraper.sendNoteTweet(content);
        elizaLogger.debug("Note tweet result:", res);
        if (res.errors && res.errors.length > 0) {
          res = await sendTweet(scraper, content);
        } else {
          return null;
        }
      } else {
        res = await sendTweet(scraper, content);
      }
      return {
        userName: (_j = (_i = (_h = (_g = (_f = (_e = (_d = (_c = res == null ? void 0 : res.data) == null ? void 0 : _c.create_tweet) == null ? void 0 : _d.tweet_results) == null ? void 0 : _e.result) == null ? void 0 : _f.core) == null ? void 0 : _g.user_results) == null ? void 0 : _h.result) == null ? void 0 : _i.legacy) == null ? void 0 : _j.screen_name,
        id: (_n = (_m = (_l = (_k = res == null ? void 0 : res.data) == null ? void 0 : _k.create_tweet) == null ? void 0 : _l.tweet_results) == null ? void 0 : _m.result) == null ? void 0 : _n.rest_id
      };
    } catch (error) {
      throw new Error(`Note Tweet failed: ${error}`);
    }
  } catch (error) {
    elizaLogger.error("Error posting tweet:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
      cause: error.cause
    });
    return null;
  }
}
var postAction = {
  name: "POST_TWEET",
  similes: ["TWEET", "POST", "SEND_TWEET"],
  description: "Post a tweet to Twitter",
  validate: async (runtime, _message, _state) => {
    const username = runtime.getSetting("TWITTER_USERNAME");
    const password = runtime.getSetting("TWITTER_PASSWORD");
    const email = runtime.getSetting("TWITTER_EMAIL");
    const hasCredentials = !!username && !!password && !!email;
    elizaLogger.log(`Has credentials: ${hasCredentials}`);
    return hasCredentials;
  },
  handler: async (runtime, message, state, options, callback) => {
    try {
      const tweetContent = await composeTweet(runtime, message, state);
      if (!tweetContent) {
        elizaLogger.error("No content generated for tweet");
        callback({
          text: null,
          model: null,
          tweetId: null,
          url: null
        });
        return false;
      }
      elizaLogger.log(`Generated tweet content: ${tweetContent}`);
      if (process.env.TWITTER_DRY_RUN && process.env.TWITTER_DRY_RUN.toLowerCase() === "true") {
        elizaLogger.info(
          `Dry run: would have posted tweet: ${tweetContent}`
        );
        callback({
          text: null,
          model: null,
          tweetId: null,
          url: null
        });
        return true;
      }
      const result = await postTweet(runtime, tweetContent);
      if (result) {
        callback({
          text: tweetContent,
          model: runtime.modelProvider,
          id: result.id,
          userName: result.userName
        });
      } else {
        callback({
          text: null,
          model: null,
          tweetId: null,
          url: null
        });
      }
      return !!result;
    } catch (error) {
      elizaLogger.error("Error in post action:", error);
      callback({
        text: null,
        model: null,
        tweetId: null,
        url: null
      });
      return false;
    }
  },
  examples: [
    [
      {
        user: "{{user1}}",
        content: { text: "You should tweet that" }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "I'll share this update with my followers right away!",
          action: "POST_TWEET"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "Post this tweet" }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "I'll post that as a tweet now.",
          action: "POST_TWEET"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "Share that on Twitter" }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "I'll share this message on Twitter.",
          action: "POST_TWEET"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "Post that on X" }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "I'll post this message on X right away.",
          action: "POST_TWEET"
        }
      }
    ],
    [
      {
        user: "{{user1}}",
        content: { text: "You should put that on X dot com" }
      },
      {
        user: "{{agentName}}",
        content: {
          text: "I'll put this message up on X.com now.",
          action: "POST_TWEET"
        }
      }
    ]
  ]
};

// src/index.ts
var twitterPlugin = {
  name: "twitter",
  description: "Twitter integration plugin for posting tweets",
  actions: [postAction],
  evaluators: [],
  providers: []
};
var index_default = twitterPlugin;
export {
  index_default as default,
  twitterPlugin
};
//# sourceMappingURL=index.js.map