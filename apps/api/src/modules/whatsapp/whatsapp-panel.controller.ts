import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import {
  AgentReplyDto,
  ListConversationsQueryDto,
  SimulateMessageDto,
  UpdateWhatsappSettingsDto,
} from './dto/whatsapp.dto';
import { WhatsappCheckoutService } from './whatsapp-checkout.service';
import { WhatsappPanelService } from './whatsapp-panel.service';

@ApiTags('whatsapp')
@ApiBearerAuth()
@Controller('whatsapp')
export class WhatsappPanelController {
  constructor(private readonly panel: WhatsappPanelService) {}

  @Get('settings')
  @RequirePermissions('whatsapp.read')
  @ApiOperation({ summary: 'Conexão, configurações do assistente e uso do dia' })
  settings(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.panel.getSettings(user);
  }

  @Put('settings')
  @RequirePermissions('whatsapp.configure')
  updateSettings(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Body() dto: UpdateWhatsappSettingsDto,
  ) {
    return this.panel.updateSettings(user, dto);
  }

  @Post('connection/simulated')
  @HttpCode(200)
  @RequirePermissions('whatsapp.configure')
  @ApiOperation({
    summary: 'Cria o número simulado do restaurante (nenhum número real é conectado)',
  })
  createSimulated(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.panel.createSimulatedConnection(user);
  }

  @Get('conversations')
  @RequirePermissions('whatsapp.read')
  list(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ListConversationsQueryDto) {
    return this.panel.listConversations(user, query.status);
  }

  @Get('conversations/:id')
  @RequirePermissions('whatsapp.read')
  get(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.panel.getConversation(user, id);
  }

  @Post('conversations/:id/read')
  @HttpCode(200)
  @RequirePermissions('whatsapp.read')
  read(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.panel.markRead(user, id);
  }

  @Post('conversations/:id/messages')
  @RequirePermissions('whatsapp.reply')
  @ApiOperation({ summary: 'Resposta manual; a conversa passa para o atendente' })
  reply(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AgentReplyDto,
  ) {
    return this.panel.reply(user, id, dto.text);
  }

  @Post('conversations/:id/assume')
  @HttpCode(200)
  @RequirePermissions('whatsapp.reply')
  assume(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.panel.assume(user, id);
  }

  @Post('conversations/:id/release')
  @HttpCode(200)
  @RequirePermissions('whatsapp.reply')
  release(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.panel.release(user, id);
  }

  @Post('simulator/messages')
  @HttpCode(200)
  @RequirePermissions('whatsapp.configure')
  @ApiOperation({
    summary: 'Simulador: mensagem de um cliente fictício pelo mesmo caminho do webhook',
  })
  simulate(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: SimulateMessageDto) {
    return this.panel.simulate(user, dto);
  }
}

// The cart behind a checkout link, for the public menu (no login: the token is the credential).
@ApiTags('public-whatsapp')
@Public()
@Controller('public/whatsapp-carts')
export class PublicWhatsappCartController {
  constructor(private readonly checkout: WhatsappCheckoutService) {}

  @Get(':slug/:token')
  read(@Param('slug') slug: string, @Param('token') token: string) {
    return this.checkout.readSharedCart(slug, token);
  }
}
