import { Listener } from '@sapphire/framework';
import { VoiceState, ChannelType, PermissionFlagsBits } from 'discord.js';
import { prisma } from '../lib/prisma.js';
import { checkAndClaimDaily } from '../lib/user.js';
import { updateGuildRanking } from '../lib/ranking.js';

export class VoiceStateUpdateListener extends Listener {
	public constructor(context: Listener.Context, options: Listener.Options) {
		super(context, {
			...options,
			event: 'voiceStateUpdate'
		});
	}

	public async run(oldState: VoiceState, newState: VoiceState) {
		const { guild } = newState;
		const member = newState.member;
		if (!member || member.user.bot) return;

		// 1. Auto-claim daily on connect (joining any voice channel)
		if (newState.channelId && oldState.channelId !== newState.channelId) {
			const reward = await checkAndClaimDaily(member.id);
			if (reward) {
				this.container.logger.info(`Auto-granted daily reward to ${member.user.username}`);
				await updateGuildRanking(guild);
			}
		}

		// 2. User joins a Hub Channel
		if (newState.channelId && oldState.channelId !== newState.channelId) {
			const hubConfig = await prisma.hubChannel.findUnique({
				where: { id: newState.channelId }
			});

			if (hubConfig) {
				try {
					const hubChannel = newState.channel;
					if (!hubChannel || hubChannel.type !== ChannelType.GuildVoice) return;

					// Generate name from template
					const channelName = hubConfig.templateName.replace('{user}', member.displayName);

					// Create new temporary voice channel
					const tempChannel = await guild.channels.create({
						name: channelName,
						type: ChannelType.GuildVoice,
						parent: hubChannel.parent, // Same category
						permissionOverwrites: [
							{
								id: member.id,
								allow: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers, PermissionFlagsBits.MuteMembers]
							}
						]
					});

					// Move member to the new channel
					await member.voice.setChannel(tempChannel);
				} catch (error) {
					this.container.logger.error('Error creating temporary voice channel:', error);
				}
			}
		}

		// 3. User leaves a voice channel (Cleanup)
		if (oldState.channelId && oldState.channelId !== newState.channelId) {
			const oldChannel = oldState.channel;
			if (oldChannel && oldChannel.type === ChannelType.GuildVoice) {
				// Check if the channel is empty
				if (oldChannel.members.size === 0) {
					// IMPORTANT: NEVER delete the channel if it IS a Hub channel
					const allHubs = await prisma.hubChannel.findMany({
						where: { guildId: guild.id },
						select: { id: true }
					});
					
					const hubIds = allHubs.map(h => h.id);
					
					if (hubIds.includes(oldChannel.id)) {
						this.container.logger.debug(`Skipping cleanup for Hub channel: ${oldChannel.name}`);
						return;
					}

					// If it's not a hub and it's empty, we check if it belongs to a category that has a hub
					if (oldChannel.parentId) {
						const hubsInCategory = hubIds.some(id => {
							const ch = guild.channels.cache.get(id);
							return ch && ch.parentId === oldChannel.parentId;
						});

						if (hubsInCategory) {
							try {
								this.container.logger.info(`Deleting empty temporary channel: ${oldChannel.name}`);
								await oldChannel.delete('Temporary voice channel empty');
							} catch (error) {
								this.container.logger.error('Error deleting temporary voice channel:', error);
							}
						}
					}
				}
			}
		}
	}
}
