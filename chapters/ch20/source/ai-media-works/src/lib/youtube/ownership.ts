import { OwnershipCheck, YoutubeClient } from "./types";

export async function checkOwnership(
  client: YoutubeClient,
  videoId: string,
): Promise<OwnershipCheck> {
  const [video, myChannelId] = await Promise.all([
    client.getVideo(videoId),
    client.getMyChannelId(),
  ]);
  return { video, myChannelId, channelMatches: video.channelId === myChannelId };
}
