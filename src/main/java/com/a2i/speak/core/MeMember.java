/*
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */
package com.a2i.speak.core;

import com.a2i.speak.core.codec.EnvelopeDecoder;
import com.a2i.speak.core.codec.GossipDecoder;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.buffer.ByteBuf;
import io.netty.channel.ChannelFuture;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInboundHandlerAdapter;
import io.netty.channel.ChannelInitializer;
import io.netty.channel.ChannelOption;
import io.netty.channel.EventLoopGroup;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.SocketChannel;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.codec.ReplayingDecoder;
import io.netty.handler.codec.bytes.ByteArrayDecoder;
import io.netty.handler.codec.bytes.ByteArrayEncoder;
import io.netty.util.ReferenceCountUtil;
import java.io.IOException;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import reactor.core.Environment;
import reactor.core.Reactor;
import reactor.core.spec.Reactors;
import reactor.event.Event;
import reactor.function.Consumer;

/**
 *
 * @author atrimble
 */
public class MeMember extends AbstractMember {

    private static final int SERVER_THREAD_POOL_SIZE = 2;

    private static final Logger LOG = LoggerFactory.getLogger(MeMember.class);
                
    private EventLoopGroup gossipBossGroup = null;
    private EventLoopGroup gossipWorkerGroup = null;
    private EventLoopGroup dataBossGroup = null;
    private EventLoopGroup dataWorkerGroup = null;

    private final ExecutorService serverExecutor = Executors.newFixedThreadPool(SERVER_THREAD_POOL_SIZE);

    private final Environment env = new Environment();
    private Reactor reactor;

    public MeMember() {
        super();
    }

    public MeMember(String ip, int gossipPort, int dataPort) {
        super(ip, gossipPort, dataPort);
    }

    public void addGossipConsumer(final GossipListener consumer) {
        reactor.on(new Consumer<Event<GossipMessage>>() {
            @Override
            public void accept(Event<GossipMessage> m) {
                consumer.accept(m.getData());
            }
        });
    }

    @Override
    protected void initialize() {
        initializeReactor();
        initializeServers();
    }

    @Override
    public void shutdown() {
        gossipBossGroup.shutdownGracefully();
        gossipWorkerGroup.shutdownGracefully();
        dataBossGroup.shutdownGracefully();
        dataWorkerGroup.shutdownGracefully();
    }

    @Override
    public void send(Envelope message) throws IOException {
        ListenerRegistry.INSTANCE.send(message);
    }

    private void initializeReactor() {
        reactor = Reactors.reactor()
                .env(env)
                .dispatcher(Environment.RING_BUFFER)
                .get();
    }

    private void initializeServers() {
        LOG.debug("Initializing gossip server on " + getIp() + ":" + getGossipPort());

        serverExecutor.submit(new GossipServerThread());
        serverExecutor.submit(new DataServerThread());
    }

    private class GossipServerThread implements Runnable {
        @Override
        public void run() {
            gossipBossGroup = new NioEventLoopGroup();
            gossipWorkerGroup = new NioEventLoopGroup();
            try {
                ServerBootstrap b = new ServerBootstrap();
                b.group(gossipBossGroup, gossipWorkerGroup)
                        .channel(NioServerSocketChannel.class)
                        .childHandler(new ChannelInitializer<SocketChannel>() {
                            @Override
                            public void initChannel(SocketChannel ch) throws Exception {
//                                    ch.pipeline().addLast(new LoggingHandler(LogLevel.TRACE));
                                ch.pipeline().addLast(new GossipMessageDecoder());
                                ch.pipeline().addLast("encoder", new ByteArrayEncoder());
                                ch.pipeline().addLast("decoder", new ByteArrayDecoder());
                                ch.pipeline().addLast(new GossipMessageHandler());
                            }

                            @Override
                            public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) throws Exception {
                                LOG.error("Cannot initialize gossip server.", cause);
                            }
                        })
                        .option(ChannelOption.SO_BACKLOG, 128)
                        .childOption(ChannelOption.SO_KEEPALIVE, true);

                // Bind and start to accept incoming connections.
                ChannelFuture f = b.bind(getIp(), getGossipPort()).sync();

                // Wait until the server socket is closed.
                // In this example, this does not happen, but you can do that to gracefully
                // shut down your server.
                f.channel().closeFuture().sync();

                LOG.debug("Shutting down gossip server");
            } catch (InterruptedException ex) {
                LOG.error("Gossip server interrupted.", ex);
            } finally {
                gossipBossGroup.shutdownGracefully();
                gossipWorkerGroup.shutdownGracefully();
            }
        }
    }

    private class DataServerThread implements Runnable {
        @Override
        public void run() {
            dataBossGroup = new NioEventLoopGroup();
            dataWorkerGroup = new NioEventLoopGroup();
            try {
                ServerBootstrap b = new ServerBootstrap();
                b.group(dataBossGroup, dataWorkerGroup)
                        .channel(NioServerSocketChannel.class)
                        .childHandler(new ChannelInitializer<SocketChannel>() {
                            @Override
                            public void initChannel(SocketChannel ch) throws Exception {
//                                    ch.pipeline().addLast(new LoggingHandler(LogLevel.TRACE));
                                ch.pipeline().addLast(new DataMessageDecoder());
                                ch.pipeline().addLast("encoder", new ByteArrayEncoder());
                                ch.pipeline().addLast("decoder", new ByteArrayDecoder());
                                ch.pipeline().addLast(new DataMessageHandler());
                            }

                            @Override
                            public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) throws Exception {
                                LOG.error("Cannot initialize data server.", cause);
                            }
                        })
                        .option(ChannelOption.SO_BACKLOG, 128)
                        .childOption(ChannelOption.SO_KEEPALIVE, true);

                // Bind and start to accept incoming connections.
                ChannelFuture f = b.bind(getIp(), getDataPort()).sync();

                // Wait until the server socket is closed.
                // In this example, this does not happen, but you can do that to gracefully
                // shut down your server.
                f.channel().closeFuture().sync();

                LOG.debug("Shutting down data server");
            } catch (InterruptedException ex) {
                LOG.error("Gossip data interrupted.", ex);
            } finally {
                dataBossGroup.shutdownGracefully();
                dataWorkerGroup.shutdownGracefully();
            }
        }
    }

    private class GossipMessageDecoder extends ReplayingDecoder {

        @Override
        protected void decode(ChannelHandlerContext chc, ByteBuf bb, List<Object> list) throws Exception {
            int length = bb.readShort();
            list.add(bb.readBytes(length));
        }
    }

    private class GossipMessageHandler extends ChannelInboundHandlerAdapter {

        @Override
        public void channelRead(ChannelHandlerContext ctx, Object msg) {
            if(msg instanceof byte[]) {
                byte[] bytes = (byte[]) msg;
                try {
                    GossipMessage message = GossipDecoder.decode(bytes);
                    reactor.notify(Event.wrap(message));
                    
                } catch (IOException ex) {
                    LOG.error("Error decoding message.", ex);
                } finally {
                    ReferenceCountUtil.release(msg);
                }
            } else if (msg instanceof Integer) {
                // length field
            } else {
                LOG.trace(msg.getClass().getName());
            }
        }

        @Override
        public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
            LOG.error("Error in TCP Client", cause);
            ctx.close();
        }
    }

    private class DataMessageDecoder extends ReplayingDecoder {

        @Override
        protected void decode(ChannelHandlerContext chc, ByteBuf bb, List<Object> list) throws Exception {
            int length = bb.readShort();
            list.add(bb.readBytes(length));
        }
    }

    private class DataMessageHandler extends ChannelInboundHandlerAdapter {

        @Override
        public void channelRead(ChannelHandlerContext ctx, Object msg) {
            if(msg instanceof byte[]) {
                byte[] bytes = (byte[]) msg;
                try {
                    Envelope message = EnvelopeDecoder.decode(bytes);
                    message.setDecoded(false);
                    send(message);
                    
                } catch (IOException ex) {
                    LOG.error("Error decoding message.", ex);
                } finally {
                    ReferenceCountUtil.release(msg);
                }
            } else if (msg instanceof Integer) {
                // length field
            } else {
                LOG.trace(msg.getClass().getName());
            }
        }

        @Override
        public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
            LOG.error("Error in TCP Client", cause);
            ctx.close();
        }
    }
}
